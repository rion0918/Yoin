package expo.modules.yoinsongexport

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.IOException
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private const val FIRST_REQUEST_CODE = 12000
private const val LAST_REQUEST_CODE = 32000

private class PendingSave(
  val operationId: String,
  val requestCode: Int,
  val sourceUri: String,
  val promise: Promise,
) {
  @Volatile var cancelled = false
  @Volatile var settled = false
  @Volatile var destination: Uri? = null
  @Volatile var copyJob: Job? = null
}

class YoinSongExportModule : Module() {
  private val requestsById = ConcurrentHashMap<String, PendingSave>()
  private val requestsByCode = ConcurrentHashMap<Int, PendingSave>()
  private val requestCodes = AtomicInteger(FIRST_REQUEST_CODE)
  private val ioScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
  private val context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("YoinSongExport")

    AsyncFunction("saveMp3Async") {
        sourceUri: String,
        fileName: String,
        operationId: String,
        promise: Promise,
      ->
      if (operationId.isBlank()) throw IllegalArgumentException("操作IDがありません。");
      if (requestsById.containsKey(operationId))
        throw IllegalStateException("このMP3の保存処理はすでに実行中です。");

      val requestCode = nextRequestCode()
      val request = PendingSave(operationId, requestCode, sourceUri, promise)
      requestsById[operationId] = request
      requestsByCode[requestCode] = request

      val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
        addCategory(Intent.CATEGORY_OPENABLE)
        type = "audio/mpeg"
        putExtra(Intent.EXTRA_TITLE, fileName)
      }
      try {
        appContext.throwingActivity.startActivityForResult(intent, requestCode)
      } catch (error: Exception) {
        removeRequest(request)
        promise.reject("ERR_YOIN_SAVE", "保存画面を開けませんでした。", error)
      }
    }

    AsyncFunction("cancelSaveAsync") { operationId: String ->
      cancelRequest(operationId)
    }

    AsyncFunction("deleteFileAsync") { uri: String ->
      deleteDocument(Uri.parse(uri))
    }

    OnActivityResult { _, (requestCode, resultCode, data) ->
      val request = requestsByCode[requestCode] ?: return@OnActivityResult
      val uri = data?.data
      val rejected = synchronized(request) {
        if (resultCode != Activity.RESULT_OK || uri == null || request.cancelled) {
          true
        } else {
          request.destination = uri
          request.copyJob = ioScope.launch {
            copyAndResolve(request, uri)
          }
          false
        }
      }
      if (rejected) {
        if (request.cancelled && uri != null) {
          ioScope.launch {
            val removed = tryDeleteDocument(uri)
            resolveCancelled(request, cleanupFailed = !removed)
          }
        } else {
          resolveCancelled(request)
        }
        return@OnActivityResult
      }
    }
  }

  private fun nextRequestCode(): Int {
    while (true) {
      val value = requestCodes.getAndUpdate { current ->
        if (current >= LAST_REQUEST_CODE) FIRST_REQUEST_CODE else current + 1
      }
      if (!requestsByCode.containsKey(value)) return value
    }
  }

  private fun cancelRequest(operationId: String) {
    val request = requestsById[operationId] ?: return
    synchronized(request) {
      request.cancelled = true
      request.copyJob?.cancel()
    }
    val destination = request.destination
    if (destination != null && request.copyJob?.isActive != true) {
      ioScope.launch {
        val removed = tryDeleteDocument(destination)
        resolveCancelled(request, cleanupFailed = !removed)
      }
    }
  }

  private suspend fun copyAndResolve(request: PendingSave, destination: Uri) {
    try {
      val byteCount = withContext(Dispatchers.IO) {
        val input = context.contentResolver.openInputStream(Uri.parse(request.sourceUri))
          ?: throw IOException("取得済みの音源を読み取れませんでした。")
        val output = context.contentResolver.openOutputStream(destination, "w")
          ?: throw IOException("選んだ保存先へ書き込めませんでした。")
        input.use { source ->
          output.use { target ->
            val buffer = ByteArray(64 * 1024)
            var copied = 0L
            while (true) {
              currentCoroutineContext().ensureActive()
              val count = source.read(buffer)
              if (count < 0) break
              target.write(buffer, 0, count)
              copied += count
            }
            target.flush()
            copied
          }
        }
      }
      if (byteCount <= 0) throw IOException("取得した音源が空でした。")

      synchronized(request) {
        if (request.cancelled) {
          ioScope.launch {
            val removed = deleteDocument(destination)
            resolveCancelled(request, cleanupFailed = !removed)
          }
        } else if (!request.settled) {
          request.settled = true
          request.promise.resolve(
            mapOf(
              "status" to "saved",
              "uri" to destination.toString(),
              "fileName" to displayName(destination),
            ),
          )
          removeRequest(request)
        }
      }
    } catch (error: Exception) {
      val removed = withContext(NonCancellable + Dispatchers.IO) {
        tryDeleteDocument(destination)
      }
      if (request.cancelled || error is CancellationException) {
        resolveCancelled(request, cleanupFailed = !removed)
      } else {
        synchronized(request) {
          if (!request.settled) {
            request.settled = true
            if (removed) {
              request.promise.reject(
                "ERR_YOIN_SAVE",
                "保存先に書き出せませんでした。空き容量を確認して、もう一度お試しください。",
                error,
              )
            } else {
              request.promise.reject(
                "ERR_YOIN_PARTIAL_CLEANUP",
                "保存を中断しましたが、途中ファイルを削除できませんでした。保存先を確認してください。",
                error,
              )
            }
          }
        }
        removeRequest(request)
      }
    }
  }

  private fun resolveCancelled(request: PendingSave, cleanupFailed: Boolean = false) {
    synchronized(request) {
      if (!request.settled) {
        request.settled = true
        request.promise.resolve(
          buildMap {
            put("status", "cancelled")
            if (cleanupFailed) put("cleanupFailed", true)
          },
        )
      }
    }
    removeRequest(request)
  }

  private fun deleteDocument(uri: Uri): Boolean {
    return context.contentResolver.delete(uri, null, null) > 0
  }

  private fun tryDeleteDocument(uri: Uri): Boolean {
    return try {
      deleteDocument(uri)
    } catch (_: Exception) {
      false
    }
  }

  private fun displayName(uri: Uri): String {
    context.contentResolver.query(
      uri,
      arrayOf(OpenableColumns.DISPLAY_NAME),
      null,
      null,
      null,
    )?.use { cursor ->
      if (cursor.moveToFirst()) {
        val index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
        if (index >= 0) cursor.getString(index)?.let { return it }
      }
    }
    return "Yoinの曲.mp3"
  }

  private fun removeRequest(request: PendingSave) {
    requestsById.remove(request.operationId, request)
    requestsByCode.remove(request.requestCode, request)
  }
}

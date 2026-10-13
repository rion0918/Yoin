package expo.modules.yoinaudiometadata

import android.media.MediaMetadataRetriever
import android.net.Uri
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class YoinAudioMetadataModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("YoinAudioMetadata")

    AsyncFunction("getDurationMsAsync") Coroutine { sourceUri: String ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      withContext(Dispatchers.IO) {
        val retriever = MediaMetadataRetriever()
        try {
          retriever.setDataSource(context, Uri.parse(sourceUri))
          retriever
            .extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)
            ?.toLongOrNull()
            ?.takeIf { it > 0 }
            ?: throw IllegalArgumentException("Audio duration is unavailable.")
        } finally {
          retriever.release()
        }
      }
    }
  }
}

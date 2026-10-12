import {
  createLyrics,
  createReadings,
  GoogleProviderError,
  generateMusic,
  parseTranscription,
  transcribeAudio,
} from "../../pipeline/google.ts";

export class ProviderNotSubmittedError extends Error {
  constructor(code) {
    super(code);
    this.name = "ProviderNotSubmittedError";
  }
}

function runtimeTargets(stage, body, origin) {
  const claimUrl = signedTarget(
    body.claimUrl,
    origin,
    /^\/internal\/attempts\/[a-zA-Z0-9_-]{1,200}\/claim$/,
  );
  const base = claimUrl.pathname.slice(0, -6);
  const resultUrl = signedTarget(
    body.resultUrl,
    origin,
    /^\/internal\/attempts\/[a-zA-Z0-9_-]{1,200}\/result$/,
  );
  if (resultUrl.pathname !== `${base}/result`)
    throw new Error("runtime_attempt_mismatch");
  const rawUrl = signedTarget(
    body.rawUrl,
    origin,
    /^\/internal\/attempts\/[a-zA-Z0-9_-]{1,200}\/raw$/,
  );
  if (rawUrl.pathname !== `${base}/raw`)
    throw new Error("runtime_attempt_mismatch");
  let sourceUrl, songUrl;
  if (stage === "transcribe")
    sourceUrl = signedTarget(
      body.sourceUrl,
      origin,
      /^\/internal\/chunks\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+\/[0-2]$/,
    );
  if (stage === "music") {
    songUrl = signedTarget(
      body.songUploadUrl,
      origin,
      /^\/internal\/attempts\/[a-zA-Z0-9_-]{1,200}\/song$/,
    );
    if (songUrl.pathname !== `${base}/song`)
      throw new Error("runtime_attempt_mismatch");
  }
  return { claimUrl, resultUrl, rawUrl, sourceUrl, songUrl };
}

function safeErrorCode(error) {
  return typeof error?.message === "string" && /^[a-z_]+$/.test(error.message)
    ? error.message
    : "provider_not_submitted";
}

function signedTarget(value, origin, path) {
  const url = new URL(value);
  if (
    url.origin !== origin ||
    !path.test(url.pathname) ||
    !url.searchParams.has("signature")
  )
    throw new Error("invalid_runtime_target");
  return url;
}

async function upload(url, bytes, contentType) {
  const response = await fetch(url, {
    method: "PUT",
    redirect: "error",
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(bytes.byteLength),
    },
    body: bytes,
    signal: AbortSignal.timeout(180_000),
  });
  if (!response.ok)
    throw new Error("runtime_result_upload_failed", {
      cause: { status: response.status },
    });
  return response.json();
}

export async function runProvider(
  stage,
  body,
  { origin, apiKey, providerFetch },
) {
  if (!apiKey) throw new ProviderNotSubmittedError("provider_not_configured");
  let targets;
  try {
    targets = runtimeTargets(stage, body, origin);
  } catch (error) {
    throw new ProviderNotSubmittedError(safeErrorCode(error));
  }
  const { claimUrl, resultUrl, rawUrl, sourceUrl, songUrl } = targets;
  const claim = await fetch(claimUrl, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  if (!claim.ok || (await claim.json()).stage !== stage)
    throw new Error("runtime_attempt_not_claimed");
  const options = { apiKey, fetch: providerFetch };
  let result, value;
  try {
    if (stage === "transcribe") {
      const audio = await fetch(sourceUrl, {
        redirect: "error",
        signal: AbortSignal.timeout(180_000),
      });
      if (
        !audio.ok ||
        Number(audio.headers.get("content-length")) > 16 * 1024 * 1024
      )
        throw new Error("runtime_source_download_failed");
      const bytes = new Uint8Array(await audio.arrayBuffer());
      if (bytes.byteLength < 1 || bytes.byteLength > 16 * 1024 * 1024)
        throw new Error("invalid_runtime_audio_size");
      result = await transcribeAudio({
        ...options,
        bytes,
        mimeType: "audio/mp4",
        clipId: body.clipId,
        offsetMs: body.offsetMs,
        durationMs: body.durationMs,
      });
      value = result.utterances;
    } else if (stage === "lyrics") {
      result = await createLyrics({
        ...options,
        utterances: body.utterances,
        generationVersion: body.generationVersion,
        musicPreferences: body.musicPreferences,
      });
      value = result.blocks;
    } else if (stage === "readings") {
      result = await createReadings({
        ...options,
        blocks: body.blocks,
        utterances: body.utterances,
      });
      value = result.blocks;
    } else {
      result = await generateMusic({
        ...options,
        blocks: body.blocks,
        generationVersion: body.generationVersion,
        musicPreferences: body.musicPreferences,
      });
    }
  } catch (error) {
    if (error instanceof GoogleProviderError && error.response !== null) {
      try {
        const raw = Buffer.from(JSON.stringify(error.response));
        if (raw.byteLength <= 100 * 1024 * 1024)
          await upload(rawUrl, raw, "application/json");
      } catch (storageError) {
        console.error(
          JSON.stringify({
            event: "provider_response_storage_failed",
            status:
              typeof storageError?.cause?.status === "number"
                ? storageError.cause.status
                : null,
          }),
        );
        // Preserve the provider outcome when diagnostic storage is unavailable.
      }
    }
    throw error;
  }
  const raw = Buffer.from(JSON.stringify(result.usage?.raw));
  if (raw.byteLength > 100 * 1024 * 1024)
    throw new Error("runtime_raw_result_too_large");
  const storedRaw = await upload(rawUrl, raw, "application/json");
  if (stage === "music")
    value = {
      ...(await upload(songUrl, result.bytes, result.mimeType)),
      returnedLyrics: result.returnedLyrics,
    };
  const output = {
    value,
    costUsd: result.costUsd,
    usage: {
      model: result.usage?.model,
      costSource: result.usage?.costSource,
      rawKey: storedRaw.key,
    },
  };
  const cached = Buffer.from(JSON.stringify({ version: 1, ...output }));
  if (cached.byteLength > 4 * 1024 * 1024)
    throw new Error("runtime_result_too_large");
  await upload(resultUrl, cached, "application/json");
  return output;
}

export async function recoverTranscription(body, { origin }) {
  const rawSource = signedTarget(
    body.rawSourceUrl,
    origin,
    /^\/internal\/attempts\/[a-zA-Z0-9_-]{1,200}\/raw$/,
  );
  const resultTarget = signedTarget(
    body.resultUrl,
    origin,
    /^\/internal\/attempts\/[a-zA-Z0-9_-]{1,200}\/result$/,
  );
  if (rawSource.pathname.slice(0, -4) !== resultTarget.pathname.slice(0, -7))
    throw new Error("runtime_attempt_mismatch");
  const response = await fetch(rawSource, {
    redirect: "error",
    signal: AbortSignal.timeout(180_000),
  });
  if (!response.ok || !response.body)
    throw new Error("saved_transcription_missing");
  const parts = [];
  let size = 0;
  for await (const part of response.body) {
    size += part.byteLength;
    if (size > 100 * 1024 * 1024)
      throw new Error("runtime_raw_result_too_large");
    parts.push(part);
  }
  const raw = JSON.parse(Buffer.concat(parts).toString("utf8"));
  const result = parseTranscription(raw, {
    clipId: body.clipId,
    offsetMs: body.offsetMs,
    durationMs: body.durationMs,
  });
  const attemptId = rawSource.pathname.split("/").at(-2);
  const output = {
    value: result.utterances,
    costUsd: result.costUsd,
    usage: {
      model: result.usage?.model,
      costSource: result.usage?.costSource,
      rawAttemptId: attemptId,
    },
  };
  const cached = Buffer.from(JSON.stringify({ version: 1, ...output }));
  if (cached.byteLength > 4 * 1024 * 1024)
    throw new Error("runtime_result_too_large");
  await upload(resultTarget, cached, "application/json");
  return output;
}

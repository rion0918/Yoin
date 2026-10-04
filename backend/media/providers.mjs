import {
  createLyrics,
  generateMusic,
  transcribeAudio,
} from "../../pipeline/google.ts";

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
  if (!response.ok) throw new Error("runtime_result_upload_failed");
  return response.json();
}

export async function runProvider(
  stage,
  body,
  { origin, apiKey, providerFetch },
) {
  if (!apiKey) throw new Error("provider_not_configured");
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
  const claim = await fetch(claimUrl, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  if (!claim.ok || (await claim.json()).stage !== stage)
    throw new Error("runtime_attempt_not_claimed");
  const options = { apiKey, fetch: providerFetch };
  let result, value;
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
    });
    value = result.utterances;
  } else if (stage === "lyrics") {
    result = await createLyrics({ ...options, utterances: body.utterances });
    value = result.blocks;
  } else {
    result = await generateMusic({ ...options, blocks: body.blocks });
    value = {
      ...(await upload(songUrl, result.bytes, result.mimeType)),
      returnedLyrics: result.returnedLyrics,
    };
  }
  const raw = Buffer.from(JSON.stringify(result.usage?.raw));
  if (raw.byteLength > 100 * 1024 * 1024)
    throw new Error("runtime_raw_result_too_large");
  const storedRaw = await upload(rawUrl, raw, "application/json");
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

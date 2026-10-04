import { getContainer } from "@cloudflare/containers";
import {
  CHUNK_MS,
  MAX_AUDIO_MS,
  type MediaInspection,
} from "../shared/contracts.ts";
import type { ClipRow, JobRow } from "./database.ts";
import { chunkKey } from "./media-api.ts";
import { signedUrl } from "./security.ts";
import { type Env, HttpError } from "./types.ts";

async function callMedia(env: Env, name: string, path: string, body: unknown) {
  if (!env.MEDIA_SERVICE_TOKEN || env.MEDIA_SERVICE_TOKEN.length < 32)
    throw new HttpError(503, "media_service_not_configured");
  const container = getContainer(env.MEDIA_CONTAINER, name);
  const response = await container.fetch(
    new Request(`http://media${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.MEDIA_SERVICE_TOKEN}`,
      },
      body: JSON.stringify(body),
    }),
  );
  if (!response.ok) throw new HttpError(502, "media_inspection_failed");
  return (await response.json()) as MediaInspection;
}

export async function inspectClip(env: Env, job: JobRow, clip: ClipRow) {
  if (clip.inspection_json)
    return JSON.parse(clip.inspection_json) as MediaInspection;
  const mediaOrigin = env.MEDIA_API_URL ?? env.PUBLIC_API_URL;
  const source = await signedUrl(
    env,
    `/media/${clip.id}`,
    "GET",
    3600,
    mediaOrigin,
  );
  const uploads = await Promise.all(
    [0, 1, 2].map((index) =>
      signedUrl(
        env,
        `/internal/chunks/${job.id}/${clip.id}/${index}`,
        "PUT",
        3600,
        mediaOrigin,
      ),
    ),
  );
  const inspection = await callMedia(env, `prepare-${job.id}`, "/inspect", {
    sourceUrl: source.url,
    uploadUrls: uploads.map((item) => item.url),
  });
  if (
    !Number.isSafeInteger(inspection.durationMs) ||
    inspection.durationMs < 1 ||
    inspection.durationMs > MAX_AUDIO_MS ||
    inspection.sizeBytes !== clip.size_bytes ||
    !Array.isArray(inspection.chunks) ||
    inspection.chunks.length < 1 ||
    inspection.chunks.length > 3
  )
    throw new HttpError(422, "invalid_media_inspection");
  for (const [index, chunk] of inspection.chunks.entries()) {
    if (
      chunk.key !== chunkKey(job.owner_id, job.id, clip.id, index) ||
      chunk.mimeType !== "audio/mp4" ||
      !Number.isSafeInteger(chunk.offsetMs) ||
      !Number.isSafeInteger(chunk.durationMs) ||
      chunk.offsetMs < 0 ||
      chunk.durationMs < 1 ||
      chunk.durationMs > CHUNK_MS + 1000 ||
      chunk.offsetMs + chunk.durationMs > inspection.durationMs + 1000
    )
      throw new HttpError(422, "invalid_media_chunk");
    if (!(await env.AUDIO.head(chunk.key)))
      throw new HttpError(422, "media_chunk_missing");
  }
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE clips SET duration_ms = ?, inspection_json = ? WHERE id = ? AND owner_id = ?",
    ).bind(
      inspection.durationMs,
      JSON.stringify(inspection),
      clip.id,
      job.owner_id,
    ),
    env.DB.prepare(
      "UPDATE audio_objects SET duration_ms = ? WHERE id = ? AND owner_id = ?",
    ).bind(inspection.durationMs, clip.id, job.owner_id),
  ]);
  return inspection;
}

export async function probeSong(env: Env, job: JobRow, audioId: string) {
  const source = await signedUrl(
    env,
    `/media/${audioId}`,
    "GET",
    3600,
    env.MEDIA_API_URL ?? env.PUBLIC_API_URL,
  );
  const inspection = await callMedia(env, `generate-${job.id}`, "/probe", {
    sourceUrl: source.url,
  });
  if (
    !Number.isSafeInteger(inspection.durationMs) ||
    inspection.durationMs < 1 ||
    inspection.durationMs > 10 * 60 * 1000 ||
    !Number.isSafeInteger(inspection.sizeBytes) ||
    inspection.sizeBytes < 1
  )
    throw new HttpError(422, "invalid_generated_audio");
  return inspection;
}

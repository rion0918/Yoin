import { GoogleProviderError } from "../pipeline/google.ts";
import {
  CHUNK_MS,
  MAX_AUDIO_MS,
  MAX_SPEAKER_SAMPLE_BYTES,
  MAX_SPEAKER_SAMPLE_MS,
  type MediaInspection,
  MIN_SPEAKER_SAMPLE_MS,
  type RegisteredSpeaker,
  SPEAKER_EMBEDDING_DIM,
  SPEAKER_MODEL_VERSION,
  type SpeakerMatch,
} from "../shared/contracts.ts";
import {
  analyzeTranscriptCoverage,
  hasContinuousCoverage,
} from "./audio-coverage.ts";
import type { ClipRow, JobRow } from "./database.ts";
import { chunkKey } from "./media-api.ts";
import { signedUrl } from "./security.ts";
import { type Env, HttpError } from "./types.ts";

const paidProviderPaths = [
  "/transcribe",
  "/lyrics",
  "/music",
  "/readings",
] as const;

function mediaConfigurationError(path: string) {
  if ((paidProviderPaths as readonly string[]).includes(path))
    return new GoogleProviderError(
      path.slice(1) as "transcribe" | "lyrics" | "music" | "readings",
      "not_submitted",
      503,
      "media_service_not_configured",
    );
  return new HttpError(503, "media_service_not_configured");
}

export async function callMedia<T>(
  env: Env,
  path: string,
  body: unknown,
  attemptId?: string,
): Promise<T> {
  if (
    !env.MEDIA_SERVICE_URL ||
    !env.MEDIA_SERVICE_TOKEN ||
    env.MEDIA_SERVICE_TOKEN.length < 32
  )
    throw mediaConfigurationError(path);
  let service: URL;
  try {
    service = new URL(env.MEDIA_SERVICE_URL);
  } catch {
    throw mediaConfigurationError(path);
  }
  if (
    service.protocol !== "https:" &&
    service.hostname !== "127.0.0.1" &&
    service.hostname !== "localhost"
  )
    throw mediaConfigurationError(path);
  const response = await fetch(
    new Request(new URL(path, service), {
      method: "POST",
      redirect: "manual",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.MEDIA_SERVICE_TOKEN}`,
        ...(attemptId ? { "X-Provider-Attempt": attemptId } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(850_000),
    }),
  );
  if (!response.ok) {
    if (path === "/enroll-speaker" || path === "/identify-speakers") {
      const result = (await response.json().catch(() => null)) as {
        error?: unknown;
      } | null;
      const code =
        typeof result?.error === "string" && /^[a-z_]+$/.test(result.error)
          ? result.error
          : "speaker_identification_failed";
      throw new HttpError(response.status === 422 ? 422 : 502, code);
    }
    if (
      response.headers.get("X-Provider-Input-Rejected") === "true" &&
      paidProviderPaths.includes(path as (typeof paidProviderPaths)[number])
    )
      throw new GoogleProviderError(
        path.slice(1) as "transcribe" | "lyrics" | "music" | "readings",
        "input",
      );
    if (
      response.headers.get("X-Provider-Not-Submitted") === "true" &&
      paidProviderPaths.includes(path as (typeof paidProviderPaths)[number])
    ) {
      const result = (await response.json().catch(() => null)) as {
        error?: unknown;
      } | null;
      const code =
        typeof result?.error === "string" && /^[a-z_]+$/.test(result.error)
          ? result.error
          : "provider_not_submitted";
      throw new GoogleProviderError(
        path.slice(1) as "transcribe" | "lyrics" | "music" | "readings",
        "not_submitted",
        response.status,
        code,
      );
    }
    throw new HttpError(502, "media_inspection_failed");
  }
  return (await response.json()) as T;
}

export async function enrollSpeakerAudio(
  env: Env,
  speakerId: string,
  sampleId: string,
): Promise<{
  modelVersion: string;
  embedding: number[];
  speechDurationMs: number;
  sizeBytes: number;
  durationMs: number;
}> {
  const source = await signedUrl(
    env,
    `/internal/speakers/${speakerId}/samples/${sampleId}`,
    "GET",
    3600,
    env.MEDIA_API_URL ?? env.PUBLIC_API_URL,
  );
  const result = await callMedia<unknown>(env, "/enroll-speaker", {
    sourceUrl: source.url,
  });
  if (!result || typeof result !== "object")
    throw new HttpError(502, "invalid_speaker_embedding");
  const value = result as Record<string, unknown>;
  if (
    value.modelVersion !== SPEAKER_MODEL_VERSION ||
    !Array.isArray(value.embedding) ||
    value.embedding.length !== SPEAKER_EMBEDDING_DIM ||
    value.embedding.some(
      (item) => typeof item !== "number" || !Number.isFinite(item),
    ) ||
    Math.abs(Math.hypot(...(value.embedding as number[])) - 1) > 0.01 ||
    !Number.isSafeInteger(value.sizeBytes) ||
    Number(value.sizeBytes) < 1 ||
    Number(value.sizeBytes) > MAX_SPEAKER_SAMPLE_BYTES ||
    !Number.isSafeInteger(value.durationMs) ||
    Number(value.durationMs) < MIN_SPEAKER_SAMPLE_MS ||
    Number(value.durationMs) > MAX_SPEAKER_SAMPLE_MS ||
    !Number.isSafeInteger(value.speechDurationMs) ||
    Number(value.speechDurationMs) < 1
  )
    throw new HttpError(502, "invalid_speaker_embedding");
  return value as {
    modelVersion: string;
    embedding: number[];
    speechDurationMs: number;
    sizeBytes: number;
    durationMs: number;
  };
}

export async function identifySpeakersInChunk(
  env: Env,
  job: JobRow,
  clip: ClipRow,
  input: {
    index: number;
    offsetMs: number;
    durationMs: number;
    utterances: Array<{
      id: string;
      speaker: string;
      startMs: number;
      endMs: number;
    }>;
    profiles: RegisteredSpeaker[];
  },
): Promise<SpeakerMatch[]> {
  const source = await signedUrl(
    env,
    `/internal/chunks/${job.id}/${clip.id}/${input.index}`,
    "GET",
    3600,
    env.MEDIA_API_URL ?? env.PUBLIC_API_URL,
  );
  const result = await callMedia<unknown>(env, "/identify-speakers", {
    chunkUrl: source.url,
    offsetMs: input.offsetMs,
    durationMs: input.durationMs,
    utterances: input.utterances,
    profiles: input.profiles,
  });
  const allowed = new Set(
    input.profiles
      .filter((profile) => profile.modelVersion === SPEAKER_MODEL_VERSION)
      .map((profile) => profile.id),
  );
  const labels = new Set(
    input.utterances
      .filter((item) => item.speaker !== "unknown")
      .map((item) => item.speaker),
  );
  const unknownIds = new Set(
    input.utterances
      .filter((item) => item.speaker === "unknown")
      .map((item) => item.id),
  );
  if (
    !result ||
    typeof result !== "object" ||
    !Array.isArray((result as { matches?: unknown }).matches) ||
    (result as { modelVersion?: unknown }).modelVersion !==
      SPEAKER_MODEL_VERSION
  )
    throw new HttpError(502, "invalid_speaker_matches");
  const matches = (result as { matches: unknown[] }).matches;
  if (matches.length !== labels.size + unknownIds.size)
    throw new HttpError(502, "invalid_speaker_matches");
  const seen = new Set<string>();
  return matches.map((item) => {
    const match = item as {
      speaker?: unknown;
      speakerProfileId?: unknown;
      utteranceId?: unknown;
    };
    const identity =
      typeof match.utteranceId === "string"
        ? `utterance:${match.utteranceId}`
        : `speaker:${String(match.speaker)}`;
    if (
      typeof match.speaker !== "string" ||
      (match.utteranceId === undefined
        ? !labels.has(match.speaker) || match.speaker === "unknown"
        : match.speaker !== "unknown" ||
          typeof match.utteranceId !== "string" ||
          !unknownIds.has(match.utteranceId)) ||
      seen.has(identity) ||
      (match.speakerProfileId !== null &&
        (typeof match.speakerProfileId !== "string" ||
          !allowed.has(match.speakerProfileId)))
    )
      throw new HttpError(502, "invalid_speaker_matches");
    seen.add(identity);
    return {
      speaker: match.speaker,
      speakerProfileId: match.speakerProfileId as string | null,
      ...(typeof match.utteranceId === "string"
        ? { utteranceId: match.utteranceId }
        : {}),
    };
  });
}

export async function inspectClip(env: Env, job: JobRow, clip: ClipRow) {
  const sourceObject = await env.AUDIO.head(clip.object_key);
  if (!sourceObject) throw new HttpError(422, "media_source_missing");
  if (clip.inspection_json) {
    const cached = JSON.parse(clip.inspection_json) as MediaInspection;
    const reusable =
      cached.transformVersion === 1 &&
      cached.sourceEtag === sourceObject.httpEtag &&
      cached.sizeBytes === clip.size_bytes &&
      Number.isSafeInteger(cached.durationMs) &&
      Array.isArray(cached.chunks) &&
      cached.chunks.length >= 1 &&
      hasContinuousCoverage(cached.durationMs, cached.chunks) &&
      cached.chunks.every((chunk, index) => {
        const key = chunk.key.split("/");
        return (
          chunk.mimeType === "audio/mp4" &&
          Number.isSafeInteger(chunk.offsetMs) &&
          Number.isSafeInteger(chunk.durationMs) &&
          chunk.durationMs <= CHUNK_MS + 1000 &&
          Array.isArray(chunk.activityRanges) &&
          key.length === 5 &&
          key[0] === "processed" &&
          key[1] === job.owner_id &&
          /^[a-zA-Z0-9_-]+$/.test(key[2] ?? "") &&
          key[3] === clip.id &&
          key[4] === `${index}.m4a` &&
          chunk.activityRanges.every(
            (range) =>
              Number.isSafeInteger(range.startMs) &&
              Number.isSafeInteger(range.endMs) &&
              range.startMs >= chunk.offsetMs &&
              range.endMs <= chunk.offsetMs + chunk.durationMs &&
              range.endMs > range.startMs,
          )
        );
      });
    if (reusable) {
      const objects = await Promise.all(
        cached.chunks.map((chunk) => env.AUDIO.head(chunk.key)),
      );
      if (objects.every(Boolean)) return cached;
    }
  }
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
  const inspection = await callMedia<MediaInspection>(env, "/inspect", {
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
    inspection.chunks.length > 3 ||
    inspection.transformVersion !== 1 ||
    inspection.sourceEtag !== sourceObject.httpEtag ||
    !hasContinuousCoverage(inspection.durationMs, inspection.chunks)
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
    if (
      !Array.isArray(chunk.activityRanges) ||
      chunk.activityRanges.some(
        (range) =>
          !Number.isSafeInteger(range.startMs) ||
          !Number.isSafeInteger(range.endMs) ||
          range.startMs < chunk.offsetMs ||
          range.endMs > chunk.offsetMs + chunk.durationMs ||
          range.endMs <= range.startMs,
      )
    )
      throw new HttpError(422, "invalid_media_activity");
    if (!(await env.AUDIO.head(chunk.key)))
      throw new HttpError(422, "media_chunk_missing");
  }
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE clips SET duration_ms = ?, inspection_json = ?, processing_json = ? WHERE id = ? AND owner_id = ?",
    ).bind(
      inspection.durationMs,
      JSON.stringify(inspection),
      JSON.stringify({
        status: "unverified",
        recordedDurationMs: clip.capture_duration_ms,
        clientDurationMs: clip.client_duration_ms || clip.duration_ms,
        serverDurationMs: inspection.durationMs,
        processedMs: inspection.durationMs,
        speechActivityMs: analyzeTranscriptCoverage({
          durationMs: inspection.durationMs,
          activityRanges: inspection.chunks.flatMap(
            (chunk) => chunk.activityRanges ?? [],
          ),
          utterances: [],
        }).speechActivityMs,
        transcribedMs: 0,
        unrecognizedActivityMs: 0,
        expectedChunks: inspection.chunks.length,
        completedChunks: 0,
        unrecognizedRanges: [],
      }),
      clip.id,
      job.owner_id,
    ),
    env.DB.prepare(
      "UPDATE audio_objects SET duration_ms = ? WHERE id = ? AND owner_id = ?",
    ).bind(inspection.durationMs, clip.id, job.owner_id),
  ]);
  return inspection;
}

export async function probeSong(env: Env, _job: JobRow, audioId: string) {
  const source = await signedUrl(
    env,
    `/media/${audioId}`,
    "GET",
    3600,
    env.MEDIA_API_URL ?? env.PUBLIC_API_URL,
  );
  const inspection = await callMedia<MediaInspection>(env, "/probe", {
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

import {
  MAX_SPEAKER_SAMPLE_BYTES,
  MAX_SPEAKER_SAMPLE_MS,
  MIN_SPEAKER_SAMPLE_MS,
  type RegisteredSpeaker,
  SPEAKER_EMBEDDING_DIM,
  SPEAKER_MODEL_VERSION,
  type SpeakerProfile,
  type SpeakerSampleDocument,
} from "../shared/contracts.ts";
import { enrollSpeakerAudio } from "./media.ts";
import { fixedBody } from "./media-api.ts";
import { verifySignedUrl } from "./security.ts";
import { type Env, HttpError } from "./types.ts";
import { id, integer, json, text } from "./validation.ts";

type SpeakerRow = {
  id: string;
  owner_id: string;
  name: string;
  sample_id: string | null;
  pending_sample_id: string | null;
  model_version: string | null;
  embedding_json: string | null;
};
type SampleRow = {
  id: string;
  speaker_id: string;
  owner_id: string;
  mime_type: string;
  size_bytes: number;
  duration_ms: number;
  object_key: string;
  status: SpeakerSampleDocument["status"];
};

async function ownedSpeaker(env: Env, owner: string, speakerId: string) {
  const row = await env.DB.prepare(
    "SELECT * FROM speaker_profiles WHERE id = ? AND owner_id = ?",
  )
    .bind(speakerId, owner)
    .first<SpeakerRow>();
  if (!row) throw new HttpError(404, "speaker_not_found");
  return row;
}
async function ownedSample(
  env: Env,
  owner: string,
  speakerId: string,
  sampleId: string,
) {
  const row = await env.DB.prepare(
    "SELECT * FROM speaker_samples WHERE id = ? AND speaker_id = ? AND owner_id = ?",
  )
    .bind(sampleId, speakerId, owner)
    .first<SampleRow>();
  if (!row) throw new HttpError(404, "speaker_sample_not_found");
  return row;
}
function document(row: SpeakerRow): SpeakerProfile {
  return {
    id: row.id,
    name: row.name,
    status: row.sample_id ? "ready" : "pending",
    sampleId: row.sample_id,
    modelVersion: row.model_version,
  };
}
function sampleDocument(row: SampleRow): SpeakerSampleDocument {
  return { id: row.id, speakerProfileId: row.speaker_id, status: row.status };
}
async function rows(env: Env, owner: string) {
  return (
    await env.DB.prepare(
      "SELECT * FROM speaker_profiles WHERE owner_id = ? ORDER BY created_at, id",
    )
      .bind(owner)
      .all<SpeakerRow>()
  ).results;
}
export async function speakerProfiles(env: Env, owner: string) {
  return (await rows(env, owner)).map(document);
}
export async function registeredSpeakers(
  env: Env,
  owner: string,
): Promise<RegisteredSpeaker[]> {
  return (await rows(env, owner))
    .filter((row) => row.sample_id && row.embedding_json && row.model_version)
    .map((row) => ({
      id: row.id,
      name: row.name,
      modelVersion: row.model_version as string,
      embedding: JSON.parse(row.embedding_json as string) as number[],
    }));
}

export function validateVoiceEmbedding(value: unknown): {
  embedding: number[];
  modelVersion: string;
  speechDurationMs: number;
  sizeBytes?: number;
  durationMs?: number;
} {
  const result = value as {
    embedding?: unknown;
    modelVersion?: unknown;
    speechDurationMs?: unknown;
    sizeBytes?: unknown;
    durationMs?: unknown;
  } | null;
  const sizeBytes = result?.sizeBytes;
  const durationMs = result?.durationMs;
  if (
    !result ||
    result.modelVersion !== SPEAKER_MODEL_VERSION ||
    !Array.isArray(result.embedding) ||
    result.embedding.length !== SPEAKER_EMBEDDING_DIM ||
    result.embedding.some(
      (v) => typeof v !== "number" || !Number.isFinite(v),
    ) ||
    Math.abs(Math.hypot(...result.embedding) - 1) > 0.01 ||
    typeof result.speechDurationMs !== "number" ||
    !Number.isSafeInteger(result.speechDurationMs) ||
    result.speechDurationMs < 2_000 ||
    result.speechDurationMs > MAX_SPEAKER_SAMPLE_MS ||
    (sizeBytes !== undefined &&
      (typeof sizeBytes !== "number" ||
        !Number.isSafeInteger(sizeBytes) ||
        sizeBytes < 1 ||
        sizeBytes > MAX_SPEAKER_SAMPLE_BYTES)) ||
    (durationMs !== undefined &&
      (typeof durationMs !== "number" ||
        !Number.isSafeInteger(durationMs) ||
        durationMs < MIN_SPEAKER_SAMPLE_MS ||
        durationMs > MAX_SPEAKER_SAMPLE_MS))
  )
    throw new HttpError(502, "invalid_speaker_embedding");
  return {
    embedding: result.embedding as number[],
    modelVersion: SPEAKER_MODEL_VERSION,
    speechDurationMs: result.speechDurationMs,
    ...(typeof sizeBytes === "number" ? { sizeBytes } : {}),
    ...(typeof durationMs === "number" ? { durationMs } : {}),
  };
}

export async function serveSpeakerSample(
  request: Request,
  env: Env,
  speakerId: string,
  sampleId: string,
) {
  await verifySignedUrl(request, env);
  const sample = await ownedSample(env, env.OWNER_ID, speakerId, sampleId);
  if (sample.status === "uploading")
    throw new HttpError(409, "speaker_sample_not_uploaded");
  const object = await env.AUDIO.get(sample.object_key);
  if (!object) throw new HttpError(404, "speaker_sample_not_found");
  return new Response(object.body, {
    headers: {
      "Content-Type": sample.mime_type,
      "Content-Length": String(object.size),
      "Cache-Control": "private, no-store",
    },
  });
}

async function enroll(
  env: Env,
  owner: string,
  speakerId: string,
  sampleId: string,
) {
  const speaker = await ownedSpeaker(env, owner, speakerId);
  const sample = await ownedSample(env, owner, speakerId, sampleId);
  if (sample.status === "ready" && speaker.sample_id === sampleId) {
    await removeSupersededSamples(env, owner, speakerId);
    return Response.json(document(await ownedSpeaker(env, owner, speakerId)));
  }
  if (speaker.pending_sample_id !== sampleId)
    throw new HttpError(409, "speaker_sample_superseded");
  if (sample.status === "uploading")
    throw new HttpError(409, "speaker_sample_not_uploaded");
  const key = `voices/${owner}/${speakerId}/${sampleId}.json`;
  const cached = await env.AUDIO.get(key);
  let value: unknown;
  if (cached) value = await cached.json();
  else {
    value = await enrollSpeakerAudio(env, speakerId, sampleId);
  }
  const result = validateVoiceEmbedding(value);
  if (
    (result.sizeBytes !== undefined &&
      result.sizeBytes !== sample.size_bytes) ||
    (result.durationMs !== undefined &&
      Math.abs(result.durationMs - sample.duration_ms) > 1000)
  )
    throw new HttpError(422, "speaker_sample_metadata_mismatch");
  if (!cached)
    await env.AUDIO.put(key, JSON.stringify(result), {
      httpMetadata: { contentType: "application/json" },
    });
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE speaker_profiles SET sample_id = ?, model_version = ?, embedding_json = ? WHERE id = ? AND owner_id = ? AND pending_sample_id = ?",
    ).bind(
      sampleId,
      result.modelVersion,
      JSON.stringify(result.embedding),
      speakerId,
      owner,
      sampleId,
    ),
    env.DB.prepare(
      "UPDATE speaker_samples SET status = 'ready' WHERE id = ? AND owner_id = ? AND EXISTS (SELECT 1 FROM speaker_profiles WHERE id = ? AND sample_id = ?)",
    ).bind(sampleId, owner, speakerId, sampleId),
    ...(speaker.sample_id && speaker.sample_id !== sampleId
      ? [
          env.DB.prepare(
            "UPDATE speaker_samples SET status = 'superseded' WHERE id = ? AND speaker_id = ? AND owner_id = ? AND EXISTS (SELECT 1 FROM speaker_profiles WHERE id = ? AND sample_id = ?)",
          ).bind(speaker.sample_id, speakerId, owner, speakerId, sampleId),
        ]
      : []),
  ]);
  const saved = await ownedSpeaker(env, owner, speakerId);
  if (saved.sample_id !== sampleId)
    throw new HttpError(409, "speaker_sample_superseded");
  await removeSupersededSamples(env, owner, speakerId);
  return Response.json(document(saved));
}

async function removeSupersededSamples(
  env: Env,
  owner: string,
  speakerId: string,
) {
  const superseded = (
    await env.DB.prepare(
      "SELECT id, object_key FROM speaker_samples WHERE speaker_id = ? AND owner_id = ? AND status = 'superseded'",
    )
      .bind(speakerId, owner)
      .all<{ id: string; object_key: string }>()
  ).results;
  if (!superseded.length) return;
  await env.AUDIO.delete(
    superseded.flatMap(({ id: sampleId, object_key }) => [
      object_key,
      `voices/${owner}/${speakerId}/${sampleId}.json`,
    ]),
  );
  await env.DB.batch(
    superseded.map(({ id: sampleId }) =>
      env.DB.prepare(
        "DELETE FROM speaker_samples WHERE id = ? AND speaker_id = ? AND owner_id = ? AND status = 'superseded'",
      ).bind(sampleId, speakerId, owner),
    ),
  );
}

export async function handleSpeakers(
  request: Request,
  env: Env,
  owner: string,
  path: string,
): Promise<Response | null> {
  if (path === "/speakers") {
    if (request.method === "GET")
      return Response.json(await speakerProfiles(env, owner));
    if (request.method !== "POST") return null;
    const body = await json(request);
    const speakerId = id(body.id);
    const name = text(body.name, 80);
    const inserted = await env.DB.prepare(
      "INSERT OR IGNORE INTO speaker_profiles (id, owner_id, name, created_at) VALUES (?, ?, ?, ?)",
    )
      .bind(speakerId, owner, name, new Date().toISOString())
      .run();
    const row = await ownedSpeaker(env, owner, speakerId);
    if (row.name !== name)
      throw new HttpError(409, "speaker_metadata_conflict");
    return Response.json(document(row), {
      status: inserted.meta.changes === 1 ? 201 : 200,
    });
  }
  const match =
    /^\/speakers\/([a-zA-Z0-9_-]+)(?:\/samples(?:\/([a-zA-Z0-9_-]+)(?:\/(audio|enroll))?)?)?$/.exec(
      path,
    );
  if (!match) return null;
  const speakerId = id(match[1]);
  const speaker = await ownedSpeaker(env, owner, speakerId);
  if (!path.includes("/samples")) {
    if (request.method === "GET") return Response.json(document(speaker));
    if (request.method === "PATCH") {
      const body = await json(request);
      await env.DB.prepare(
        "UPDATE speaker_profiles SET name = ? WHERE id = ? AND owner_id = ?",
      )
        .bind(text(body.name, 80), speakerId, owner)
        .run();
      return Response.json(document(await ownedSpeaker(env, owner, speakerId)));
    }
    if (request.method === "DELETE") {
      const samples = (
        await env.DB.prepare(
          "SELECT * FROM speaker_samples WHERE speaker_id = ? AND owner_id = ?",
        )
          .bind(speakerId, owner)
          .all<SampleRow>()
      ).results;
      for (const sample of samples)
        await env.AUDIO.delete([
          sample.object_key,
          `voices/${owner}/${speakerId}/${sample.id}.json`,
        ]);
      await env.DB.prepare(
        "DELETE FROM speaker_profiles WHERE id = ? AND owner_id = ?",
      )
        .bind(speakerId, owner)
        .run();
      return Response.json({ deleted: true });
    }
    return null;
  }
  if (!match[2] && request.method === "POST") {
    const body = await json(request);
    const sampleId = id(body.id);
    const mimeType = text(body.mimeType, 80);
    if (
      ![
        "audio/mp4",
        "audio/m4a",
        "audio/x-m4a",
        "audio/mpeg",
        "audio/wav",
        "audio/aac",
      ].includes(mimeType)
    )
      throw new HttpError(422, "unsupported_audio_format");
    const size = integer(body.sizeBytes, 1, MAX_SPEAKER_SAMPLE_BYTES);
    const duration = integer(
      body.durationMs,
      MIN_SPEAKER_SAMPLE_MS,
      MAX_SPEAKER_SAMPLE_MS,
    );
    const existing = await env.DB.prepare(
      "SELECT * FROM speaker_samples WHERE id = ?",
    )
      .bind(sampleId)
      .first<SampleRow>();
    if (existing) {
      if (
        existing.owner_id !== owner ||
        existing.speaker_id !== speakerId ||
        existing.size_bytes !== size ||
        existing.duration_ms !== duration ||
        existing.mime_type !== mimeType
      )
        throw new HttpError(409, "speaker_sample_conflict");
      return Response.json(sampleDocument(existing));
    }
    const key = `voices/${owner}/${speakerId}/${sampleId}.audio`;
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO speaker_samples (id, speaker_id, owner_id, mime_type, size_bytes, duration_ms, object_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ).bind(
        sampleId,
        speakerId,
        owner,
        mimeType,
        size,
        duration,
        key,
        new Date().toISOString(),
      ),
      env.DB.prepare(
        "UPDATE speaker_profiles SET pending_sample_id = ? WHERE id = ? AND owner_id = ?",
      ).bind(sampleId, speakerId, owner),
    ]);
    return Response.json(
      sampleDocument(await ownedSample(env, owner, speakerId, sampleId)),
      { status: 201 },
    );
  }
  if (!match[2]) return null;
  const sampleId = id(match[2]);
  const sample = await ownedSample(env, owner, speakerId, sampleId);
  if (!match[3] && request.method === "GET")
    return Response.json(sampleDocument(sample));
  if (match[3] === "enroll" && request.method === "POST")
    return enroll(env, owner, speakerId, sampleId);
  if (match[3] === "audio" && request.method === "PUT") {
    if (sample.status !== "uploading")
      return Response.json(sampleDocument(sample));
    await fixedBody(request, sample.size_bytes, (body) =>
      env.AUDIO.put(sample.object_key, body, {
        httpMetadata: { contentType: sample.mime_type },
      }),
    );
    await env.DB.prepare(
      "UPDATE speaker_samples SET status = 'uploaded' WHERE id = ? AND owner_id = ?",
    )
      .bind(sampleId, owner)
      .run();
    return Response.json(
      sampleDocument(await ownedSample(env, owner, speakerId, sampleId)),
    );
  }
  return null;
}

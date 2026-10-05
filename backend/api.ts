import {
  MAX_AUDIO_MS,
  UPLOAD_PART_BYTES,
  type UploadCreated,
} from "../shared/contracts.ts";
import {
  assertAccountActive,
  finishOwnedUpload,
  getAccount,
  requestDeletion,
} from "./accounts.ts";
import {
  audioClip,
  type ClipRow,
  clips,
  draftDocument,
  type JobRow,
  jobDocument,
  ownedAudio,
  ownedClip,
  ownedDraft,
  ownedJob,
  songDocument,
  utterances,
} from "./database.ts";
import {
  fixedBody,
  serveMedia,
  serveMediaChunk,
  uploadMediaChunk,
} from "./media-api.ts";
import { runtimeCallback } from "./runtime-api.ts";
import { authenticate, sha256, signedUrl } from "./security.ts";
import {
  handleSpeakers,
  registeredSpeakers,
  serveSpeakerSample,
} from "./speakers.ts";
import { type Env, HttpError } from "./types.ts";
import {
  clipMetadata,
  id,
  integer,
  json,
  text,
  validateBlocks,
} from "./validation.ts";

async function launch(env: Env, job: JobRow) {
  const workflow = job.kind === "prepare" ? env.PREPARE : env.GENERATE;
  try {
    await assertAccountActive(env, job.owner_id);
    const instance = await workflow.create({
      id: job.id,
      params: { jobId: job.id },
    });
    try {
      await assertAccountActive(env, job.owner_id);
    } catch (error) {
      await instance.delete();
      throw error;
    }
  } catch (error) {
    if (error instanceof HttpError && error.code === "account_deleted")
      throw error;
    // A durable queued row remains available if dispatch fails or the instance already exists.
  }
}

async function createDraft(request: Request, env: Env, owner: string) {
  const body = await json(request);
  const draftId = id(body.id);
  const title = text(body.title, 80);
  const createdAt = text(body.createdAt, 100);
  if (!Number.isFinite(Date.parse(createdAt)))
    throw new HttpError(422, "invalid_date");
  const result = await env.DB.prepare(
    "INSERT OR IGNORE INTO drafts (id, owner_id, title, created_at) SELECT ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE uid = ? AND status != 'active')",
  )
    .bind(draftId, owner, title, createdAt, owner)
    .run();
  const document = await draftDocument(env, draftId, owner);
  return Response.json(document, {
    status: result.meta.changes === 1 ? 201 : 200,
  });
}

async function uploadDocument(env: Env, clip: ClipRow): Promise<UploadCreated> {
  if (!clip.upload_id) throw new HttpError(503, "upload_not_ready");
  const parts = (
    await env.DB.prepare(
      "SELECT part_number AS partNumber, etag FROM upload_parts WHERE clip_id = ? ORDER BY part_number",
    )
      .bind(clip.id)
      .all<{ partNumber: number; etag: string }>()
  ).results;
  return {
    uploadId: clip.upload_id,
    partBytes: UPLOAD_PART_BYTES,
    parts,
    complete: clip.status === "uploaded",
  };
}

async function createClip(
  request: Request,
  env: Env,
  owner: string,
  draftId: string,
) {
  const draft = await ownedDraft(env, draftId, owner);
  const body = await json(request);
  const metadata = clipMetadata(body, draftId);
  let clip = await env.DB.prepare(
    "SELECT * FROM clips WHERE id = ? AND owner_id = ?",
  )
    .bind(metadata.id, owner)
    .first<ClipRow>();
  if (clip) {
    if (JSON.stringify(audioClip(clip)) !== JSON.stringify(metadata))
      throw new HttpError(409, "clip_metadata_conflict");
  } else {
    if (draft.status !== "uploading")
      throw new HttpError(409, "draft_sources_frozen");
    const key = `originals/${owner}/${metadata.id}`;
    const inserted = await env.DB.prepare(
      "INSERT OR IGNORE INTO clips (id, draft_id, owner_id, mime_type, size_bytes, duration_ms, recorded_at, imported_at, timezone, place, object_key) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE (SELECT COALESCE(SUM(duration_ms), 0) FROM clips WHERE draft_id = ? AND owner_id = ?) + ? <= ? AND (SELECT status FROM drafts WHERE id = ? AND owner_id = ?) = 'uploading' AND NOT EXISTS (SELECT 1 FROM accounts WHERE uid = ? AND status != 'active')",
    )
      .bind(
        metadata.id,
        draftId,
        owner,
        metadata.mimeType,
        metadata.sizeBytes,
        metadata.durationMs,
        metadata.recordedAt,
        metadata.importedAt,
        metadata.timezone,
        metadata.place,
        key,
        draftId,
        owner,
        metadata.durationMs,
        MAX_AUDIO_MS,
        draftId,
        owner,
        owner,
      )
      .run();
    if (inserted.meta.changes !== 1)
      throw new HttpError(409, "clip_conflict_or_audio_limit");
    clip = await ownedClip(env, metadata.id, owner);
  }
  if (!clip.upload_id) {
    const upload = await env.AUDIO.createMultipartUpload(clip.object_key, {
      httpMetadata: { contentType: clip.mime_type },
    });
    const saved = await env.DB.prepare(
      "UPDATE clips SET upload_id = ? WHERE id = ? AND owner_id = ? AND upload_id IS NULL AND NOT EXISTS (SELECT 1 FROM accounts WHERE uid = ? AND status != 'active')",
    )
      .bind(upload.uploadId, clip.id, owner, owner)
      .run();
    if (saved.meta.changes !== 1) await upload.abort();
    clip = await ownedClip(env, clip.id, owner);
  }
  return Response.json(await uploadDocument(env, clip), { status: 200 });
}

async function uploadPart(
  request: Request,
  env: Env,
  owner: string,
  clipId: string,
  partNumber: number,
) {
  const clip = await ownedClip(env, clipId, owner);
  const uploadId = new URL(request.url).searchParams.get("uploadId");
  if (
    clip.status !== "uploading" ||
    !clip.upload_id ||
    uploadId !== clip.upload_id
  )
    throw new HttpError(409, "invalid_upload");
  const total = Math.ceil(clip.size_bytes / UPLOAD_PART_BYTES);
  integer(partNumber, 1, total);
  const existing = await env.DB.prepare(
    "SELECT etag FROM upload_parts WHERE clip_id = ? AND part_number = ?",
  )
    .bind(clipId, partNumber)
    .first<{ etag: string }>();
  if (existing) return Response.json({ partNumber, etag: existing.etag });
  const size =
    partNumber === total
      ? clip.size_bytes - (total - 1) * UPLOAD_PART_BYTES
      : UPLOAD_PART_BYTES;
  const upload = env.AUDIO.resumeMultipartUpload(
    clip.object_key,
    clip.upload_id,
  );
  const part = (await fixedBody(request, size, (body) =>
    upload.uploadPart(partNumber, body),
  )) as R2UploadedPart;
  try {
    await assertAccountActive(env, owner);
  } catch (error) {
    await upload.abort();
    throw error;
  }
  await env.DB.prepare(
    "INSERT INTO upload_parts (clip_id, part_number, etag, size_bytes) VALUES (?, ?, ?, ?) ON CONFLICT (clip_id, part_number) DO UPDATE SET etag = excluded.etag, size_bytes = excluded.size_bytes",
  )
    .bind(clipId, partNumber, part.etag, size)
    .run();
  return Response.json({ partNumber, etag: part.etag });
}

async function completeUpload(
  request: Request,
  env: Env,
  owner: string,
  clipId: string,
) {
  const clip = await ownedClip(env, clipId, owner);
  const body = await json(request);
  if (!clip.upload_id || body.uploadId !== clip.upload_id)
    throw new HttpError(409, "invalid_upload");
  if (clip.status === "uploaded") return Response.json({ complete: true });
  const stored = await uploadDocument(env, clip);
  const expected = Math.ceil(clip.size_bytes / UPLOAD_PART_BYTES);
  const suppliedParts = body.parts;
  if (
    !Array.isArray(suppliedParts) ||
    suppliedParts.length !== expected ||
    stored.parts.length !== expected ||
    stored.parts.some(
      (part) =>
        !suppliedParts.some(
          (candidate) =>
            candidate &&
            typeof candidate === "object" &&
            candidate.partNumber === part.partNumber &&
            candidate.etag === part.etag,
        ),
    )
  )
    throw new HttpError(422, "incomplete_upload");
  let object = await env.AUDIO.head(clip.object_key);
  if (!object)
    object = await env.AUDIO.resumeMultipartUpload(
      clip.object_key,
      clip.upload_id,
    ).complete(stored.parts);
  await finishOwnedUpload(env, owner, clip.object_key);
  if (object.size !== clip.size_bytes)
    throw new HttpError(422, "upload_size_mismatch");
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE clips SET status = 'uploaded' WHERE id = ? AND owner_id = ?",
    ).bind(clipId, owner),
    env.DB.prepare(
      "INSERT OR IGNORE INTO audio_objects (id, owner_id, draft_id, object_key, mime_type, size_bytes, duration_ms, kind) VALUES (?, ?, ?, ?, ?, ?, ?, 'original')",
    ).bind(
      clipId,
      owner,
      clip.draft_id,
      clip.object_key,
      clip.mime_type,
      clip.size_bytes,
      clip.duration_ms,
    ),
  ]);
  return Response.json({ complete: true });
}

async function prepare(
  request: Request,
  env: Env,
  owner: string,
  draftId: string,
) {
  const body = await json(request);
  const sourceClips = await clips(env, draftId, owner);
  if (
    !sourceClips.length ||
    sourceClips.some((clip) => clip.status !== "uploaded")
  )
    throw new HttpError(409, "audio_upload_incomplete");
  return submitJob(
    env,
    owner,
    draftId,
    "prepare",
    text(body.idempotencyKey, 128),
    null,
    null,
    await sha256(
      JSON.stringify({ draftId, clips: sourceClips.map((clip) => clip.id) }),
    ),
  );
}

async function reviseLyrics(
  request: Request,
  env: Env,
  owner: string,
  draftId: string,
) {
  const draft = await ownedDraft(env, draftId, owner);
  const body = await json(request);
  const expected = integer(body.revision, 1, 1_000_000);
  if (
    !["waiting_review", "failed"].includes(draft.status) ||
    draft.lyric_revision !== expected
  )
    throw new HttpError(409, "lyric_revision_conflict");
  const blocks = validateBlocks(
    body.blocks,
    await utterances(env, draftId, owner),
  );
  const revision = expected + 1;
  const result = await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO lyric_revisions (draft_id, revision, blocks_json, created_at) SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM drafts WHERE id = ? AND owner_id = ? AND lyric_revision = ? AND status IN ('waiting_review', 'failed'))",
    ).bind(
      draftId,
      revision,
      JSON.stringify(blocks),
      new Date().toISOString(),
      draftId,
      owner,
      expected,
    ),
    env.DB.prepare(
      "UPDATE drafts SET lyric_revision = ?, status = 'waiting_review', error = NULL WHERE id = ? AND owner_id = ? AND lyric_revision = ? AND status IN ('waiting_review', 'failed')",
    ).bind(revision, draftId, owner, expected),
  ]);
  if (result[0].meta.changes !== 1)
    throw new HttpError(409, "lyric_revision_conflict");
  return Response.json({ revision, blocks });
}

async function generate(
  request: Request,
  env: Env,
  owner: string,
  draftId: string,
) {
  const body = await json(request);
  const revision = integer(body.revision, 1, 1_000_000);
  const draft = await ownedDraft(env, draftId, owner);
  if (draft.lyric_revision !== revision)
    throw new HttpError(409, "lyric_revision_conflict");
  const row = await env.DB.prepare(
    "SELECT blocks_json FROM lyric_revisions WHERE draft_id = ? AND revision = ?",
  )
    .bind(draftId, revision)
    .first<{ blocks_json: string }>();
  if (!row) throw new HttpError(409, "lyrics_not_ready");
  validateBlocks(
    JSON.parse(row.blocks_json),
    await utterances(env, draftId, owner),
  );
  return submitJob(
    env,
    owner,
    draftId,
    "generate",
    text(body.idempotencyKey, 128),
    revision,
    row.blocks_json,
    await sha256(
      JSON.stringify({ draftId, revision, blocks: row.blocks_json }),
    ),
  );
}

async function submitJob(
  env: Env,
  owner: string,
  draftId: string,
  kind: "prepare" | "generate",
  key: string,
  revision: number | null,
  blocks: string | null,
  fingerprint: string,
) {
  const previous = await env.DB.prepare(
    "SELECT * FROM jobs WHERE owner_id = ? AND kind = ? AND idempotency_key = ?",
  )
    .bind(owner, kind, key)
    .first<JobRow>();
  if (previous) {
    if (previous.fingerprint !== fingerprint)
      throw new HttpError(409, "idempotency_key_conflict");
    if (previous.status === "queued") await launch(env, previous);
    return Response.json({ jobId: previous.id }, { status: 202 });
  }
  const draft = await ownedDraft(env, draftId, owner);
  const allowed =
    kind === "prepare" ? ["uploading", "failed"] : ["waiting_review", "failed"];
  if (!allowed.includes(draft.status))
    throw new HttpError(409, "draft_not_ready");
  const jobId = crypto.randomUUID();
  const state = kind === "prepare" ? "preparing" : "generating";
  const created = new Date().toISOString();
  const speakerSnapshot =
    kind === "prepare"
      ? JSON.stringify(await registeredSpeakers(env, owner))
      : null;
  const result = await env.DB.batch([
    env.DB.prepare(
      "INSERT OR IGNORE INTO jobs (id, owner_id, draft_id, kind, idempotency_key, fingerprint, lyric_revision, blocks_json, created_at, speaker_snapshot_json) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM drafts WHERE id = ? AND owner_id = ? AND status = ? AND job_id IS ? AND lyric_revision = ?) AND NOT EXISTS (SELECT 1 FROM accounts WHERE uid = ? AND status != 'active')",
    ).bind(
      jobId,
      owner,
      draftId,
      kind,
      key,
      fingerprint,
      revision,
      blocks,
      created,
      speakerSnapshot,
      draftId,
      owner,
      draft.status,
      draft.job_id,
      draft.lyric_revision,
      owner,
    ),
    env.DB.prepare(
      "UPDATE drafts SET status = ?, job_id = ?, error = NULL WHERE id = ? AND owner_id = ? AND EXISTS (SELECT 1 FROM jobs WHERE id = ?)",
    ).bind(state, jobId, draftId, owner, jobId),
  ]);
  if (result[0].meta.changes !== 1) {
    const duplicate = await env.DB.prepare(
      "SELECT * FROM jobs WHERE owner_id = ? AND kind = ? AND idempotency_key = ?",
    )
      .bind(owner, kind, key)
      .first<JobRow>();
    if (!duplicate || duplicate.fingerprint !== fingerprint)
      throw new HttpError(409, "draft_or_idempotency_conflict");
    return Response.json({ jobId: duplicate.id }, { status: 202 });
  }
  const job = await ownedJob(env, jobId, owner);
  await launch(env, job);
  return Response.json({ jobId }, { status: 202 });
}

export async function handleRequest(request: Request, env: Env) {
  try {
    const url = new URL(request.url);
    const path = url.pathname;
    const speakerSample =
      /^\/internal\/speakers\/([a-zA-Z0-9_-]+)\/samples\/([a-zA-Z0-9_-]+)$/.exec(
        path,
      );
    if (speakerSample && request.method === "GET")
      return await serveSpeakerSample(
        request,
        env,
        id(speakerSample[1]),
        id(speakerSample[2]),
      );
    const runtime =
      /^\/internal\/attempts\/([a-zA-Z0-9_-]{1,200})\/(claim|result|raw|song)$/.exec(
        path,
      );
    if (runtime && request.method === (runtime[2] === "claim" ? "POST" : "PUT"))
      return await runtimeCallback(request, env, runtime[1], runtime[2]);
    const media = /^\/media\/([a-zA-Z0-9_-]+)$/.exec(path);
    if (media && ["GET", "HEAD"].includes(request.method))
      return await serveMedia(request, env, id(media[1]));
    const chunk =
      /^\/internal\/chunks\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_-]+)\/(\d+)$/.exec(
        path,
      );
    if (chunk && request.method === "GET")
      return await serveMediaChunk(
        request,
        env,
        id(chunk[1]),
        id(chunk[2]),
        Number(chunk[3]),
      );
    if (chunk && request.method === "PUT")
      return await uploadMediaChunk(
        request,
        env,
        id(chunk[1]),
        id(chunk[2]),
        Number(chunk[3]),
      );
    const identity = await authenticate(request, env);
    if (path === "/account" && request.method === "GET")
      return await getAccount(env, identity);
    if (path === "/account/deletion" && request.method === "POST")
      return await requestDeletion(env, identity);
    const owner = identity.uid;
    await assertAccountActive(env, owner);
    const speakerResponse = await handleSpeakers(request, env, owner, path);
    if (speakerResponse) return speakerResponse;
    if (path === "/drafts" && request.method === "POST")
      return await createDraft(request, env, owner);
    const draft =
      /^\/drafts\/([a-zA-Z0-9_-]+)(?:\/(clips|prepare|lyrics|generate))?$/.exec(
        path,
      );
    if (draft) {
      const draftId = id(draft[1]);
      await ownedDraft(env, draftId, owner);
      if (!draft[2] && request.method === "GET")
        return Response.json(await draftDocument(env, draftId, owner));
      if (draft[2] === "clips" && request.method === "POST")
        return await createClip(request, env, owner, draftId);
      if (draft[2] === "prepare" && request.method === "POST")
        return await prepare(request, env, owner, draftId);
      if (draft[2] === "lyrics" && request.method === "PATCH")
        return await reviseLyrics(request, env, owner, draftId);
      if (draft[2] === "generate" && request.method === "POST")
        return await generate(request, env, owner, draftId);
    }
    const part = /^\/clips\/([a-zA-Z0-9_-]+)\/parts\/(\d+)$/.exec(path);
    if (part && request.method === "PUT")
      return await uploadPart(
        request,
        env,
        owner,
        id(part[1]),
        Number(part[2]),
      );
    const complete = /^\/clips\/([a-zA-Z0-9_-]+)\/complete$/.exec(path);
    if (complete && request.method === "POST")
      return await completeUpload(request, env, owner, id(complete[1]));
    const job = /^\/jobs\/([a-zA-Z0-9_-]+)$/.exec(path);
    if (job && request.method === "GET") {
      const row = await ownedJob(env, id(job[1]), owner);
      if (row.status === "queued") await launch(env, row);
      return Response.json(jobDocument(row));
    }
    if (path === "/songs" && request.method === "GET") {
      const rows = (
        await env.DB.prepare(
          "SELECT id FROM songs WHERE owner_id = ? ORDER BY created_at DESC",
        )
          .bind(owner)
          .all<{ id: string }>()
      ).results;
      return Response.json(
        await Promise.all(rows.map((row) => songDocument(env, row.id, owner))),
      );
    }
    const song = /^\/songs\/([a-zA-Z0-9_-]+)$/.exec(path);
    if (song && request.method === "GET")
      return Response.json(await songDocument(env, id(song[1]), owner));
    const audio = /^\/audio\/([a-zA-Z0-9_-]+)\/url$/.exec(path);
    if (audio && request.method === "POST") {
      await ownedAudio(env, id(audio[1]), owner);
      return Response.json(await signedUrl(env, `/media/${audio[1]}`));
    }
    return Response.json({ error: "route_not_found" }, { status: 404 });
  } catch (error) {
    if (error instanceof HttpError)
      return Response.json({ error: error.code }, { status: error.status });
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
}

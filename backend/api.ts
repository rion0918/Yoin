import {
  type AudioLocationSummary,
  type LocationSample,
  MAX_AUDIO_MS,
  type MusicPreferences,
  type RegisteredSpeaker,
  type TranscriptSpeakerAssignment,
  UPLOAD_PART_BYTES,
  type UploadCreated,
} from "../shared/contracts.ts";
import { hasReadyReadings, isLyricSection } from "../shared/music.ts";
import {
  canAssignSpeaker,
  SPEAKER_MATCHING_CONFIG,
} from "../shared/speaker-matching.ts";
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
  lyrics,
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
import { recoverDraftMusic } from "./music-recovery.ts";
import { privacyPolicyHtml } from "./privacy-policy.ts";
import { runtimeCallback } from "./runtime-api.ts";
import { authenticate, sha256, signedUrl } from "./security.ts";
import {
  handleSpeakers,
  registeredSpeakers,
  serveSpeakerSample,
} from "./speakers.ts";
import { recoverDraftTranscript } from "./transcription.ts";
import { type Env, HttpError } from "./types.ts";
import {
  clipMetadata,
  id,
  integer,
  json,
  locationPayload,
  text,
  validateBlocks,
  validateMusicPreferences,
} from "./validation.ts";

async function launch(env: Env, job: JobRow) {
  const workflow = job.kind === "generate" ? env.GENERATE : env.PREPARE;
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
  let selectedSpeakerIds: string[] | null = null;
  if (body.speakerProfileIds !== undefined) {
    if (
      !Array.isArray(body.speakerProfileIds) ||
      !body.speakerProfileIds.length ||
      body.speakerProfileIds.some(
        (speakerId) =>
          typeof speakerId !== "string" ||
          !speakerId.length ||
          speakerId.length > 128,
      ) ||
      new Set(body.speakerProfileIds).size !== body.speakerProfileIds.length
    )
      throw new HttpError(422, "invalid_speaker_selection");
    selectedSpeakerIds = body.speakerProfileIds as string[];
    const available = new Set(
      (await registeredSpeakers(env, owner)).map((speaker) => speaker.id),
    );
    if (selectedSpeakerIds.some((speakerId) => !available.has(speakerId)))
      throw new HttpError(422, "invalid_speaker_selection");
  }
  const result = await env.DB.prepare(
    "INSERT OR IGNORE INTO drafts (id, owner_id, title, created_at, speaker_profile_ids_json) SELECT ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE uid = ? AND status != 'active')",
  )
    .bind(
      draftId,
      owner,
      title,
      createdAt,
      JSON.stringify(selectedSpeakerIds ?? []),
      owner,
    )
    .run();
  const document = await draftDocument(env, draftId, owner);
  if (
    selectedSpeakerIds &&
    JSON.stringify(document.speakerProfileIds) !==
      JSON.stringify(selectedSpeakerIds)
  )
    throw new HttpError(409, "draft_speaker_selection_conflict");
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
    const storedMetadata = audioClip(clip);
    delete storedMetadata.locationSummary;
    delete storedMetadata.processing;
    storedMetadata.durationMs = clip.client_duration_ms || clip.duration_ms;
    if (JSON.stringify(storedMetadata) !== JSON.stringify(metadata))
      throw new HttpError(409, "clip_metadata_conflict");
  } else {
    if (draft.status !== "uploading")
      throw new HttpError(409, "draft_sources_frozen");
    const key = `originals/${owner}/${metadata.id}`;
    const inserted = await env.DB.prepare(
      "INSERT OR IGNORE INTO clips (id, draft_id, owner_id, mime_type, size_bytes, duration_ms, client_duration_ms, capture_duration_ms, recorded_at, imported_at, timezone, place, object_key) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE (SELECT COALESCE(SUM(duration_ms), 0) FROM clips WHERE draft_id = ? AND owner_id = ?) + ? <= ? AND (SELECT status FROM drafts WHERE id = ? AND owner_id = ?) = 'uploading' AND NOT EXISTS (SELECT 1 FROM accounts WHERE uid = ? AND status != 'active')",
    )
      .bind(
        metadata.id,
        draftId,
        owner,
        metadata.mimeType,
        metadata.sizeBytes,
        metadata.durationMs,
        metadata.durationMs,
        metadata.captureDurationMs ?? null,
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

function routeObjectKey(owner: string, draftId: string, clipId: string) {
  return `locations/${owner}/${draftId}/${clipId}/location.json`;
}

function locationSummary(
  payload: ReturnType<typeof locationPayload>,
  key: string,
): AudioLocationSummary {
  const samples = payload.route.segments.flatMap((segment) => segment.samples);
  const byTimestamp = new Map(
    samples.map((sample) => [sample.timestamp, sample]),
  );
  return {
    startLocation: samples[0] ?? null,
    endLocation: samples.at(-1) ?? null,
    representativeLocations: payload.representativeTimestamps
      .map((timestamp) => byTimestamp.get(timestamp))
      .filter((sample): sample is LocationSample => !!sample),
    places: payload.places,
    routeObjectKey: key,
  };
}

async function saveLocationRoute(
  request: Request,
  env: Env,
  owner: string,
  clipId: string,
) {
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > 128 * 1024)
    throw new HttpError(413, "location_route_too_large");
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new HttpError(400, "invalid_json");
  }
  const clip = await ownedClip(env, clipId, owner);
  const payload = locationPayload(body, clip);
  const serialized = JSON.stringify(payload);
  const hash = await sha256(serialized);
  const key = routeObjectKey(owner, clip.draft_id, clip.id);
  if (clip.location_hash) {
    if (clip.location_hash !== hash)
      throw new HttpError(409, "location_route_conflict");
    return Response.json({ summary: locationSummary(payload, key) });
  }

  const serializedRoute = JSON.stringify({ ...payload, routeHash: hash });
  const storedRoute = await env.AUDIO.put(key, serializedRoute, {
    onlyIf: { etagDoesNotMatch: "*" },
    httpMetadata: { contentType: "application/json" },
    customMetadata: { routeHash: hash },
  });
  if (!storedRoute) {
    const existing = await env.AUDIO.head(key);
    if (existing?.customMetadata?.routeHash !== hash)
      throw new HttpError(409, "location_route_conflict");
  }
  await finishOwnedUpload(env, owner, key);
  const summary = locationSummary(payload, key);
  const result = await env.DB.prepare(
    "UPDATE clips SET location_summary_json = ?, location_hash = ? WHERE id = ? AND owner_id = ? AND location_hash IS NULL AND NOT EXISTS (SELECT 1 FROM accounts WHERE uid = ? AND status != 'active')",
  )
    .bind(JSON.stringify(summary), hash, clip.id, owner, owner)
    .run();
  if (result.meta.changes !== 1) {
    const current = await ownedClip(env, clip.id, owner);
    if (current.location_hash === hash)
      return Response.json({ summary: locationSummary(payload, key) });
    await env.AUDIO.delete(key);
    throw new HttpError(409, "location_route_conflict");
  }
  return Response.json({ summary });
}

async function getLocationRoute(env: Env, owner: string, clipId: string) {
  const clip = await ownedClip(env, clipId, owner);
  if (!clip.location_summary_json)
    throw new HttpError(404, "location_route_not_found");
  const summary = JSON.parse(
    clip.location_summary_json,
  ) as AudioLocationSummary;
  const object = await env.AUDIO.get(summary.routeObjectKey);
  if (!object) throw new HttpError(404, "location_route_not_found");
  return new Response(object.body, {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "private, no-store",
    },
  });
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
  const settings =
    body.musicPreferences === undefined
      ? undefined
      : {
          generationVersion: 2,
          musicPreferences: validateMusicPreferences(body.musicPreferences),
        };
  const sourceClips = await clips(env, draftId, owner);
  const previous = await env.DB.prepare(
    "SELECT speaker_matching_config_json FROM jobs WHERE owner_id = ? AND kind = 'prepare' AND idempotency_key = ?",
  )
    .bind(owner, text(body.idempotencyKey, 128))
    .first<{ speaker_matching_config_json: string | null }>();
  const matchingConfig = previous
    ? previous.speaker_matching_config_json
      ? JSON.parse(previous.speaker_matching_config_json)
      : null
    : SPEAKER_MATCHING_CONFIG;
  const draft = await ownedDraft(env, draftId, owner);
  const speakerProfileIds = JSON.parse(
    draft.speaker_profile_ids_json,
  ) as string[];
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
      JSON.stringify({
        draftId,
        clips: sourceClips.map((clip) => clip.id),
        speakerProfileIds,
        ...(matchingConfig ? { speakerMatchingConfig: matchingConfig } : {}),
        ...(settings
          ? {
              musicPreferences: settings.musicPreferences,
              generationVersion: 2,
            }
          : {}),
      }),
    ),
    undefined,
    undefined,
    settings,
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
  const previous = await lyrics(env, draftId, expected);
  if (
    previous?.generationVersion === 2 &&
    blocks.some((block) => !isLyricSection(block.section))
  )
    throw new HttpError(422, "invalid_lyric_section");
  const revision = expected + 1;
  const result = await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO lyric_revisions (draft_id, revision, blocks_json, created_at, generation_version, music_preferences_json) SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM drafts WHERE id = ? AND owner_id = ? AND lyric_revision = ? AND status IN ('waiting_review', 'failed'))",
    ).bind(
      draftId,
      revision,
      JSON.stringify(blocks),
      new Date().toISOString(),
      previous?.generationVersion ?? 1,
      previous?.musicPreferences
        ? JSON.stringify(previous.musicPreferences)
        : null,
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
  return Response.json({ ...previous, revision, blocks });
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
    "SELECT blocks_json, generation_version, music_preferences_json FROM lyric_revisions WHERE draft_id = ? AND revision = ?",
  )
    .bind(draftId, revision)
    .first<{
      blocks_json: string;
      generation_version: number;
      music_preferences_json: string | null;
    }>();
  if (!row) throw new HttpError(409, "lyrics_not_ready");
  const blocks = validateBlocks(
    JSON.parse(row.blocks_json),
    await utterances(env, draftId, owner),
  );
  const settings =
    row.generation_version === 2
      ? {
          generationVersion: 2,
          musicPreferences: validateMusicPreferences(
            JSON.parse(String(row.music_preferences_json)),
          ),
        }
      : undefined;
  if (settings && !hasReadyReadings(blocks))
    throw new HttpError(422, "readings_not_ready");
  const songTitle =
    body.songTitle === undefined ? draft.title : text(body.songTitle, 80);
  const fingerprint = await sha256(
    JSON.stringify({
      draftId,
      revision,
      blocks: row.blocks_json,
      songTitle,
      ...(settings
        ? { generationVersion: 2, musicPreferences: settings.musicPreferences }
        : {}),
    }),
  );
  const legacyFingerprint = await sha256(
    JSON.stringify({ draftId, revision, blocks: row.blocks_json }),
  );
  return submitJob(
    env,
    owner,
    draftId,
    "generate",
    text(body.idempotencyKey, 128),
    revision,
    row.blocks_json,
    fingerprint,
    songTitle,
    settings ? undefined : legacyFingerprint,
    settings,
  );
}

async function updateReadings(
  request: Request,
  env: Env,
  owner: string,
  draftId: string,
) {
  const body = await json(request);
  const revision = integer(body.revision, 1, 1_000_000);
  const key = text(body.idempotencyKey, 128);
  const draft = await ownedDraft(env, draftId, owner);
  const previous = await env.DB.prepare(
    "SELECT draft_id, lyric_revision FROM jobs WHERE owner_id = ? AND kind = 'readings' AND idempotency_key = ?",
  )
    .bind(owner, key)
    .first<{ draft_id: string; lyric_revision: number }>();
  if (
    previous &&
    (previous.draft_id !== draftId || previous.lyric_revision !== revision)
  )
    throw new HttpError(409, "idempotency_key_conflict");
  if (!previous && draft.lyric_revision !== revision)
    throw new HttpError(409, "lyric_revision_conflict");
  const current = await lyrics(env, draftId, revision);
  if (current?.generationVersion !== 2 || !current.musicPreferences)
    throw new HttpError(409, "readings_not_available");
  const blocks = validateBlocks(
    current.blocks,
    await utterances(env, draftId, owner),
  );
  if (blocks.some((block) => !isLyricSection(block.section)))
    throw new HttpError(422, "invalid_lyric_section");
  if (!blocks.some((block) => block.singingText === undefined))
    throw new HttpError(409, "readings_already_ready");
  const settings = {
    generationVersion: 2,
    musicPreferences: current.musicPreferences,
  };
  const frozen = JSON.stringify(blocks);
  return submitJob(
    env,
    owner,
    draftId,
    "readings",
    key,
    revision,
    frozen,
    await sha256(
      JSON.stringify({ draftId, revision, blocks: frozen, ...settings }),
    ),
    undefined,
    undefined,
    settings,
  );
}

async function reviewTranscript(
  request: Request,
  env: Env,
  owner: string,
  draftId: string,
) {
  const body = await json(request);
  const jobId = id(body.jobId);
  const fingerprint = text(body.transcriptFingerprint, 64);
  const assignments = transcriptSpeakerAssignments(body.assignments);
  if (!/^[a-f0-9]{64}$/.test(fingerprint))
    throw new HttpError(422, "invalid_transcript_fingerprint");
  const draft = await ownedDraft(env, draftId, owner);
  const job = await ownedJob(env, jobId, owner);
  if (job.kind !== "prepare" || job.draft_id !== draftId)
    throw new HttpError(409, "draft_job_conflict");
  if (draft.job_id !== job.id)
    throw new HttpError(409, "transcript_review_conflict");
  const current = await utterances(env, draftId, owner);
  const currentFingerprint = await sha256(JSON.stringify(current));
  const alreadyReviewed = Boolean(job.transcript_reviewed_at);
  if (alreadyReviewed) {
    if (currentFingerprint !== job.transcript_fingerprint)
      throw new HttpError(409, "transcript_review_conflict");
    if (
      !matchesSavedTranscriptAssignments(
        assignments,
        current,
        job.speaker_snapshot_json,
      )
    )
      throw new HttpError(409, "transcript_review_conflict");
    if (job.status === "needs_audio_review") {
      const workflow = await env.PREPARE.get(job.id);
      await workflow.sendEvent({
        type: "audio-transcript-review",
        payload: { transcriptFingerprint: currentFingerprint },
      });
    }
    return Response.json({ accepted: true });
  }
  if (job.transcript_fingerprint !== fingerprint)
    throw new HttpError(409, "transcript_review_conflict");
  if (job.status !== "needs_audio_review")
    throw new HttpError(409, "transcript_review_conflict");
  if (currentFingerprint !== fingerprint)
    throw new HttpError(409, "transcript_review_conflict");
  const snapshot = job.speaker_snapshot_json
    ? (JSON.parse(job.speaker_snapshot_json) as RegisteredSpeaker[])
    : [];
  const selectedIds = JSON.parse(draft.speaker_profile_ids_json) as string[];
  const allowedIds = new Set(
    selectedIds.length ? selectedIds : snapshot.map((profile) => profile.id),
  );
  const profileById = new Map(snapshot.map((profile) => [profile.id, profile]));
  const assignmentsByUtterance = new Map<string, RegisteredSpeaker | null>();
  for (const assignment of assignments) {
    const target = current.find((item) => item.id === assignment.utteranceId);
    const profile =
      assignment.speakerProfileId === null
        ? null
        : profileById.get(assignment.speakerProfileId);
    if (
      !target ||
      !canAssignSpeaker(target) ||
      (assignment.speakerProfileId !== null &&
        (!profile || !allowedIds.has(profile.id)))
    )
      throw new HttpError(422, "invalid_speaker_assignment");
    assignmentsByUtterance.set(assignment.utteranceId, profile ?? null);
  }
  const reviewed = current.map((item) => {
    if (!assignmentsByUtterance.has(item.id)) return item;
    const profile = assignmentsByUtterance.get(item.id);
    const { speakerProfileId: _id, speakerName: _name, ...unassigned } = item;
    return profile
      ? {
          ...item,
          speakerProfileId: profile.id,
          speakerName: profile.name,
        }
      : unassigned;
  });
  const reviewedFingerprint = await sha256(JSON.stringify(reviewed));
  const assignmentsJson = JSON.stringify(
    Object.fromEntries(
      assignments.map((assignment) => {
        const profile = assignmentsByUtterance.get(assignment.utteranceId);
        const target = current.find(
          (item) => item.id === assignment.utteranceId,
        );
        if (!target) throw new HttpError(422, "invalid_speaker_assignment");
        return [
          assignment.utteranceId,
          {
            speakerProfileId: profile?.id ?? null,
            speakerName: profile?.name ?? null,
            priorProfile: target.speakerProfileId ?? null,
            priorName: target.speakerName ?? null,
          },
        ];
      }),
    ),
  );
  const statements = assignments.length
    ? [
        env.DB.prepare(
          "UPDATE utterances AS target SET speaker_profile_id = json_extract(assignment.value, '$.speakerProfileId'), speaker_name = json_extract(assignment.value, '$.speakerName') FROM json_each(?) AS assignment WHERE assignment.key = target.id AND target.speaker_profile_id IS json_extract(assignment.value, '$.priorProfile') AND target.speaker_name IS json_extract(assignment.value, '$.priorName') AND target.clip_id IN (SELECT id FROM clips WHERE draft_id = ? AND owner_id = ?) AND EXISTS (SELECT 1 FROM jobs WHERE id = ? AND owner_id = ? AND status = 'needs_audio_review' AND transcript_fingerprint = ? AND transcript_reviewed_at IS NULL AND EXISTS (SELECT 1 FROM drafts WHERE id = jobs.draft_id AND owner_id = jobs.owner_id AND job_id = jobs.id)) AND (SELECT COUNT(*) FROM json_each(?) AS requested JOIN utterances AS eligible ON eligible.id = requested.key WHERE eligible.speaker_profile_id IS json_extract(requested.value, '$.priorProfile') AND eligible.speaker_name IS json_extract(requested.value, '$.priorName') AND eligible.clip_id IN (SELECT id FROM clips WHERE draft_id = ? AND owner_id = ?)) = ?",
        ).bind(
          assignmentsJson,
          draftId,
          owner,
          job.id,
          owner,
          fingerprint,
          assignmentsJson,
          draftId,
          owner,
          assignments.length,
        ),
      ]
    : [];
  statements.push(
    env.DB.prepare(
      "UPDATE jobs SET transcript_fingerprint = ?, transcript_reviewed_at = COALESCE(transcript_reviewed_at, ?) WHERE id = ? AND owner_id = ? AND status = 'needs_audio_review' AND transcript_fingerprint = ? AND transcript_reviewed_at IS NULL AND EXISTS (SELECT 1 FROM drafts WHERE id = jobs.draft_id AND owner_id = jobs.owner_id AND job_id = jobs.id) AND (SELECT COUNT(*) FROM json_each(?) AS assignment JOIN utterances AS target ON target.id = assignment.key WHERE target.speaker_profile_id IS json_extract(assignment.value, '$.speakerProfileId') AND target.speaker_name IS json_extract(assignment.value, '$.speakerName') AND target.clip_id IN (SELECT id FROM clips WHERE draft_id = ? AND owner_id = ?)) = ?",
    ).bind(
      reviewedFingerprint,
      new Date().toISOString(),
      job.id,
      owner,
      fingerprint,
      assignmentsJson,
      draftId,
      owner,
      assignments.length,
    ),
  );
  const result = await env.DB.batch(statements);
  if (result.at(-1)?.meta.changes !== 1)
    throw new HttpError(409, "transcript_review_conflict");
  const workflow = await env.PREPARE.get(job.id);
  await workflow.sendEvent({
    type: "audio-transcript-review",
    payload: { transcriptFingerprint: reviewedFingerprint },
  });
  return Response.json(
    { accepted: true },
    { status: alreadyReviewed ? 200 : 202 },
  );
}

function transcriptSpeakerAssignments(
  value: unknown,
): TranscriptSpeakerAssignment[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 10_000)
    throw new HttpError(422, "invalid_speaker_assignments");
  const assignments = value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item))
      throw new HttpError(422, "invalid_speaker_assignments");
    const assignment = item as Record<string, unknown>;
    return {
      utteranceId: text(assignment.utteranceId, 200),
      speakerProfileId:
        assignment.speakerProfileId === null
          ? null
          : id(assignment.speakerProfileId),
    };
  });
  if (
    new Set(assignments.map((item) => item.utteranceId)).size !==
    assignments.length
  )
    throw new HttpError(422, "invalid_speaker_assignments");
  return assignments;
}

function matchesSavedTranscriptAssignments(
  assignments: TranscriptSpeakerAssignment[],
  current: Awaited<ReturnType<typeof utterances>>,
  speakerSnapshotJson: string | null | undefined,
) {
  const snapshot = speakerSnapshotJson
    ? (JSON.parse(speakerSnapshotJson) as RegisteredSpeaker[])
    : [];
  const profiles = new Map(snapshot.map((profile) => [profile.id, profile]));
  const currentById = new Map(current.map((item) => [item.id, item]));
  return assignments.every((assignment) => {
    if (assignment.speakerProfileId === null) {
      const utterance = currentById.get(assignment.utteranceId);
      return (
        !!utterance &&
        !utterance.speakerProfileId &&
        !utterance.speakerName &&
        canAssignSpeaker(utterance)
      );
    }
    const profile = profiles.get(assignment.speakerProfileId);
    const utterance = currentById.get(assignment.utteranceId);
    return (
      !!profile &&
      utterance?.speakerProfileId === profile.id &&
      utterance.speakerName === profile.name
    );
  });
}

async function submitJob(
  env: Env,
  owner: string,
  draftId: string,
  kind: "prepare" | "generate" | "readings",
  key: string,
  revision: number | null,
  blocks: string | null,
  fingerprint: string,
  songTitle?: string,
  legacyFingerprint?: string,
  settings?: { generationVersion: number; musicPreferences: MusicPreferences },
) {
  const previous = await env.DB.prepare(
    "SELECT * FROM jobs WHERE owner_id = ? AND kind = ? AND idempotency_key = ?",
  )
    .bind(owner, kind, key)
    .first<JobRow>();
  if (previous) {
    if (
      previous.fingerprint !== fingerprint &&
      !(
        kind === "generate" &&
        previous.song_title == null &&
        previous.fingerprint === legacyFingerprint
      )
    )
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
  const state =
    kind === "prepare"
      ? "preparing"
      : kind === "readings"
        ? "updating_readings"
        : "generating";
  const created = new Date().toISOString();
  let speakerSnapshot: string | null = null;
  if (kind === "prepare") {
    const available = await registeredSpeakers(env, owner);
    const selected = JSON.parse(draft.speaker_profile_ids_json) as string[];
    const snapshot = selected.length
      ? available.filter((profile) => selected.includes(profile.id))
      : available;
    if (snapshot.length !== (selected.length || available.length))
      throw new HttpError(409, "speaker_selection_unavailable");
    speakerSnapshot = JSON.stringify(snapshot);
  }
  const result = await env.DB.batch([
    env.DB.prepare(
      "INSERT OR IGNORE INTO jobs (id, owner_id, draft_id, kind, idempotency_key, fingerprint, lyric_revision, blocks_json, song_title, created_at, speaker_snapshot_json, generation_version, music_preferences_json, speaker_matching_config_json) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM drafts WHERE id = ? AND owner_id = ? AND status = ? AND job_id IS ? AND lyric_revision = ?) AND NOT EXISTS (SELECT 1 FROM accounts WHERE uid = ? AND status != 'active')",
    ).bind(
      jobId,
      owner,
      draftId,
      kind,
      key,
      fingerprint,
      revision,
      blocks,
      songTitle ?? null,
      created,
      speakerSnapshot,
      settings?.generationVersion ?? 1,
      settings ? JSON.stringify(settings.musicPreferences) : null,
      kind === "prepare" ? JSON.stringify(SPEAKER_MATCHING_CONFIG) : null,
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
    if (
      !duplicate ||
      (duplicate.fingerprint !== fingerprint &&
        !(
          kind === "generate" &&
          duplicate.song_title == null &&
          duplicate.fingerprint === legacyFingerprint
        ))
    )
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
    if (path === "/privacy" && ["GET", "HEAD"].includes(request.method))
      return new Response(
        request.method === "HEAD" ? null : privacyPolicyHtml,
        {
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "public, max-age=300",
            "Content-Security-Policy":
              "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
            "Referrer-Policy": "no-referrer",
            "X-Content-Type-Options": "nosniff",
          },
        },
      );
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
    if (
      runtime &&
      (request.method === (runtime[2] === "claim" ? "POST" : "PUT") ||
        (runtime[2] === "raw" && request.method === "GET"))
    )
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
      /^\/drafts\/([a-zA-Z0-9_-]+)(?:\/(clips|prepare|lyrics|generate|readings|transcript-review|recover-transcription|recover-music))?$/.exec(
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
      if (draft[2] === "readings" && request.method === "POST")
        return await updateReadings(request, env, owner, draftId);
      if (draft[2] === "generate" && request.method === "POST")
        return await generate(request, env, owner, draftId);
      if (draft[2] === "recover-music" && request.method === "POST") {
        const body = await json(request);
        return await recoverDraftMusic(env, owner, draftId, id(body.jobId));
      }
      if (draft[2] === "recover-transcription" && request.method === "POST")
        return await recoverDraftTranscript(env, owner, draftId);
      if (draft[2] === "transcript-review" && request.method === "POST")
        return await reviewTranscript(request, env, owner, draftId);
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
    const location = /^\/clips\/([a-zA-Z0-9_-]+)\/location$/.exec(path);
    if (location && request.method === "PUT")
      return await saveLocationRoute(request, env, owner, id(location[1]));
    if (location && request.method === "GET")
      return await getLocationRoute(env, owner, id(location[1]));
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

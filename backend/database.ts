import type {
  AudioClip,
  DraftDocument,
  DraftStatus,
  JobDocument,
  LyricBlock,
  LyricRevision,
  SongDocument,
  Utterance,
} from "../shared/contracts.ts";
import { type Env, HttpError } from "./types.ts";

export type DraftRow = {
  id: string;
  owner_id: string;
  title: string;
  created_at: string;
  status: DraftStatus;
  lyric_revision: number;
  job_id: string | null;
  error: string | null;
};
export type ClipRow = {
  id: string;
  draft_id: string;
  owner_id: string;
  mime_type: string;
  size_bytes: number;
  duration_ms: number;
  recorded_at: string | null;
  imported_at: string | null;
  timezone: string;
  place: string | null;
  object_key: string;
  upload_id: string | null;
  status: string;
  inspection_json: string | null;
};
export type JobRow = {
  id: string;
  owner_id: string;
  draft_id: string;
  kind: "prepare" | "generate";
  idempotency_key: string;
  fingerprint: string;
  status: JobDocument["status"];
  stage: string;
  error: string | null;
  lyric_revision: number | null;
  blocks_json: string | null;
  song_id: string | null;
  created_at: string;
  speaker_snapshot_json?: string | null;
};
export type AudioRow = {
  id: string;
  owner_id: string;
  draft_id: string;
  object_key: string;
  mime_type: string;
  size_bytes: number;
  duration_ms: number;
  kind: string;
};

export async function ownedDraft(env: Env, draftId: string, owner: string) {
  const row = await env.DB.prepare(
    "SELECT * FROM drafts WHERE id = ? AND owner_id = ?",
  )
    .bind(draftId, owner)
    .first<DraftRow>();
  if (!row) throw new HttpError(404, "draft_not_found");
  return row;
}
export async function ownedClip(env: Env, clipId: string, owner: string) {
  const row = await env.DB.prepare(
    "SELECT * FROM clips WHERE id = ? AND owner_id = ?",
  )
    .bind(clipId, owner)
    .first<ClipRow>();
  if (!row) throw new HttpError(404, "clip_not_found");
  return row;
}
export async function ownedJob(env: Env, jobId: string, owner: string) {
  const row = await env.DB.prepare(
    "SELECT * FROM jobs WHERE id = ? AND owner_id = ?",
  )
    .bind(jobId, owner)
    .first<JobRow>();
  if (!row) throw new HttpError(404, "job_not_found");
  return row;
}
export async function ownedAudio(env: Env, audioId: string, owner: string) {
  const row = await env.DB.prepare(
    "SELECT * FROM audio_objects WHERE id = ? AND owner_id = ?",
  )
    .bind(audioId, owner)
    .first<AudioRow>();
  if (!row) throw new HttpError(404, "audio_not_found");
  return row;
}
export async function clips(env: Env, draftId: string, owner: string) {
  return (
    await env.DB.prepare(
      "SELECT * FROM clips WHERE draft_id = ? AND owner_id = ? ORDER BY rowid",
    )
      .bind(draftId, owner)
      .all<ClipRow>()
  ).results;
}
export function audioClip(row: ClipRow): AudioClip {
  return {
    id: row.id,
    draftId: row.draft_id,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    durationMs: row.duration_ms,
    recordedAt: row.recorded_at,
    importedAt: row.imported_at,
    timezone: row.timezone,
    place: row.place,
  };
}
export async function utterances(
  env: Env,
  draftId: string,
  owner: string,
): Promise<Utterance[]> {
  return (
    await env.DB.prepare(
      "SELECT u.id, u.clip_id AS clipId, u.start_ms AS startMs, u.end_ms AS endMs, u.speaker, u.text, u.speaker_profile_id AS speakerProfileId, u.speaker_name AS speakerName FROM utterances u JOIN clips c ON c.id = u.clip_id WHERE c.draft_id = ? AND c.owner_id = ? ORDER BY c.rowid, u.start_ms",
    )
      .bind(draftId, owner)
      .all<Utterance>()
  ).results.map((item) => {
    if (!item.speakerProfileId || !item.speakerName) {
      const { speakerProfileId: _id, speakerName: _name, ...legacy } = item;
      return legacy;
    }
    return item;
  });
}
export async function lyrics(
  env: Env,
  draftId: string,
  revision: number,
): Promise<LyricRevision | null> {
  if (revision === 0) return null;
  const row = await env.DB.prepare(
    "SELECT blocks_json FROM lyric_revisions WHERE draft_id = ? AND revision = ?",
  )
    .bind(draftId, revision)
    .first<{ blocks_json: string }>();
  return row
    ? { revision, blocks: JSON.parse(row.blocks_json) as LyricBlock[] }
    : null;
}
export async function draftDocument(
  env: Env,
  draftId: string,
  owner: string,
): Promise<DraftDocument> {
  const row = await ownedDraft(env, draftId, owner);
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    clips: (await clips(env, draftId, owner)).map(audioClip),
    utterances: await utterances(env, draftId, owner),
    lyrics: await lyrics(env, draftId, row.lyric_revision),
    status: row.status,
    jobId: row.job_id,
    error: row.error,
  };
}
export function jobDocument(row: JobRow): JobDocument {
  return {
    id: row.id,
    draftId: row.draft_id,
    kind: row.kind,
    status: row.status,
    stage: row.stage,
    error: row.error,
    songId: row.song_id,
  };
}
export async function songDocument(
  env: Env,
  songId: string,
  owner: string,
): Promise<SongDocument> {
  const row = await env.DB.prepare(
    "SELECT s.*, a.duration_ms FROM songs s JOIN audio_objects a ON a.id = s.audio_id WHERE s.id = ? AND s.owner_id = ?",
  )
    .bind(songId, owner)
    .first<{
      id: string;
      draft_id: string;
      title: string;
      created_at: string;
      lyric_revision: number;
      audio_id: string;
      duration_ms: number;
    }>();
  if (!row) throw new HttpError(404, "song_not_found");
  const revision = await lyrics(env, row.draft_id, row.lyric_revision);
  if (!revision) throw new HttpError(500, "song_lyrics_missing");
  return {
    id: row.id,
    draftId: row.draft_id,
    title: row.title,
    createdAt: row.created_at,
    clips: (await clips(env, row.draft_id, owner)).map(audioClip),
    utterances: await utterances(env, row.draft_id, owner),
    lyrics: revision,
    audioId: row.audio_id,
    durationMs: row.duration_ms,
  };
}
export async function setJob(
  env: Env,
  row: JobRow,
  status: JobDocument["status"],
  stage: string,
  error: string | null = null,
  songId: string | null = null,
) {
  const draftStatus =
    status === "queued" || status === "running"
      ? row.kind === "prepare"
        ? "preparing"
        : "generating"
      : status;
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE jobs SET status = ?, stage = ?, error = ?, song_id = COALESCE(?, song_id) WHERE id = ? AND owner_id = ?",
    ).bind(status, stage, error, songId, row.id, row.owner_id),
    env.DB.prepare(
      "UPDATE drafts SET status = ?, error = ? WHERE id = ? AND owner_id = ? AND job_id = ?",
    ).bind(draftStatus, error, row.draft_id, row.owner_id, row.id),
  ]);
}

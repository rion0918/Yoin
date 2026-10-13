import type {
  AudioClip,
  DraftDocument,
  DraftStatus,
  JobDocument,
  LyricBlock,
  LyricRevision,
  MusicPreferences,
  SongDocument,
  Utterance,
} from "../shared/contracts.ts";
import { musicRecoveryAvailable } from "./music-recovery.ts";
import { type Env, HttpError } from "./types.ts";

export type DraftRow = {
  id: string;
  owner_id: string;
  title: string;
  created_at: string;
  speaker_profile_ids_json: string;
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
  client_duration_ms: number;
  capture_duration_ms: number | null;
  processing_json: string | null;
  location_summary_json: string | null;
  location_hash: string | null;
};
export type JobRow = {
  id: string;
  owner_id: string;
  draft_id: string;
  kind: "prepare" | "generate" | "readings";
  idempotency_key: string;
  fingerprint: string;
  status: JobDocument["status"];
  stage: string;
  error: string | null;
  lyric_revision: number | null;
  blocks_json: string | null;
  song_title?: string | null;
  song_id: string | null;
  created_at: string;
  speaker_snapshot_json?: string | null;
  speaker_matching_config_json?: string | null;
  transcript_fingerprint?: string | null;
  transcript_reviewed_at?: string | null;
  expected_chunks?: number;
  completed_chunks?: number;
  generation_version?: number;
  music_preferences_json?: string | null;
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
    captureDurationMs: row.capture_duration_ms,
    recordedAt: row.recorded_at,
    importedAt: row.imported_at,
    timezone: row.timezone,
    place: row.place,
    processing: row.processing_json
      ? (JSON.parse(row.processing_json) as AudioClip["processing"])
      : {
          status: "unverified",
          recordedDurationMs: row.capture_duration_ms,
          clientDurationMs: row.client_duration_ms || row.duration_ms,
          serverDurationMs: 0,
          processedMs: 0,
          speechActivityMs: 0,
          transcribedMs: 0,
          unrecognizedActivityMs: 0,
          expectedChunks: 0,
          completedChunks: 0,
          unrecognizedRanges: [],
        },
    ...(row.location_summary_json
      ? {
          locationSummary: JSON.parse(
            row.location_summary_json,
          ) as AudioClip["locationSummary"],
        }
      : {}),
  };
}
export async function utterances(
  env: Env,
  draftId: string,
  owner: string,
): Promise<Utterance[]> {
  return (
    await env.DB.prepare(
      "SELECT u.id, u.clip_id AS clipId, u.start_ms AS startMs, u.end_ms AS endMs, u.speaker, u.text, u.speaker_profile_id AS speakerProfileId, u.speaker_name AS speakerName, u.timing_issues_json AS timingIssuesJson FROM utterances u JOIN clips c ON c.id = u.clip_id WHERE c.draft_id = ? AND c.owner_id = ? ORDER BY c.rowid, u.start_ms",
    )
      .bind(draftId, owner)
      .all<Utterance & { timingIssuesJson?: string | null }>()
  ).results.map(({ timingIssuesJson, ...row }) => {
    const item: Utterance = {
      ...row,
      ...(timingIssuesJson
        ? {
            timingIssues: JSON.parse(
              timingIssuesJson,
            ) as Utterance["timingIssues"],
          }
        : {}),
    };
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
    "SELECT blocks_json, generation_version, music_preferences_json FROM lyric_revisions WHERE draft_id = ? AND revision = ?",
  )
    .bind(draftId, revision)
    .first<{
      blocks_json: string;
      generation_version: number;
      music_preferences_json: string | null;
    }>();
  return row
    ? {
        revision,
        blocks: JSON.parse(row.blocks_json) as LyricBlock[],
        ...(row.generation_version === 2
          ? {
              generationVersion: 2 as const,
              musicPreferences: JSON.parse(
                String(row.music_preferences_json),
              ) as MusicPreferences,
            }
          : {}),
      }
    : null;
}
async function savedTranscriptionAvailable(env: Env, row: DraftRow) {
  if (!row.job_id || row.status !== "needs_reconciliation") return false;
  const attempts = (
    await env.DB.prepare(
      "SELECT p.id, p.runtime_claimed_at FROM provider_attempts p JOIN jobs j ON j.id = p.job_id AND j.owner_id = p.owner_id WHERE j.id = ? AND j.draft_id = ? AND j.owner_id = ? AND j.kind = 'prepare' AND j.status = 'needs_reconciliation' AND p.stage = 'transcribe' AND p.status = 'needs_reconciliation'",
    )
      .bind(row.job_id, row.id, row.owner_id)
      .all<{ id: string; runtime_claimed_at: string | null }>()
  ).results;
  if (
    !attempts.length ||
    attempts.some((attempt) => !attempt.runtime_claimed_at)
  )
    return false;
  for (const attempt of attempts) {
    if (
      !(await env.AUDIO.head(`results/${row.owner_id}/${attempt.id}.json`)) &&
      !(await env.AUDIO.head(`results/${row.owner_id}/${attempt.id}.raw.json`))
    )
      return false;
  }
  return true;
}

export async function draftDocument(
  env: Env,
  draftId: string,
  owner: string,
): Promise<DraftDocument> {
  const row = await ownedDraft(env, draftId, owner);
  const job = row.job_id ? await ownedJob(env, row.job_id, owner) : null;
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    speakerProfileIds: JSON.parse(row.speaker_profile_ids_json) as string[],
    clips: (await clips(env, draftId, owner)).map(audioClip),
    utterances: await utterances(env, draftId, owner),
    lyrics: await lyrics(env, draftId, row.lyric_revision),
    status: row.status,
    jobId: row.job_id,
    ...(job
      ? {
          jobKind: job.kind,
          jobStage: job.stage,
          musicRecoveryAvailable: await musicRecoveryAvailable(env, job),
        }
      : {}),
    ...(row.status === "needs_reconciliation"
      ? {
          transcriptRecoveryAvailable: await savedTranscriptionAvailable(
            env,
            row,
          ),
        }
      : {}),
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
    transcriptFingerprint: row.transcript_fingerprint ?? null,
    expectedChunks: row.expected_chunks ?? 0,
    completedChunks: row.completed_chunks ?? 0,
  };
}
export async function songDocument(
  env: Env,
  songId: string,
  owner: string,
): Promise<SongDocument> {
  const row = await env.DB.prepare(
    "SELECT s.*, a.duration_ms, d.speaker_profile_ids_json FROM songs s JOIN audio_objects a ON a.id = s.audio_id JOIN drafts d ON d.id = s.draft_id WHERE s.id = ? AND s.owner_id = ?",
  )
    .bind(songId, owner)
    .first<{
      id: string;
      draft_id: string;
      title: string;
      created_at: string;
      speaker_profile_ids_json: string;
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
    speakerProfileIds: JSON.parse(row.speaker_profile_ids_json) as string[],
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
        : row.kind === "readings"
          ? "updating_readings"
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

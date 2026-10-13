import { displayLyricsMatch, singingLyricsMatch } from "../shared/music.ts";
import { assertAccountActive } from "./accounts.ts";
import {
  type JobRow,
  lyrics,
  ownedAudio,
  ownedDraft,
  ownedJob,
} from "./database.ts";
import type { SavedMusic } from "./providers.ts";
import { type Env, HttpError } from "./types.ts";

// This path only reads a settled result; it cannot reserve or submit a provider call.
export async function readSavedMusic(
  env: Env,
  job: JobRow,
): Promise<SavedMusic> {
  const unavailable = () => new HttpError(409, "saved_music_unavailable");
  if (job.kind !== "generate" || !job.blocks_json || !job.lyric_revision)
    throw unavailable();
  const draft = await ownedDraft(env, job.draft_id, job.owner_id);
  const revision = await lyrics(env, job.draft_id, job.lyric_revision);
  if (
    draft.job_id !== job.id ||
    draft.lyric_revision !== job.lyric_revision ||
    !revision ||
    JSON.stringify(revision.blocks) !==
      JSON.stringify(JSON.parse(job.blocks_json)) ||
    (revision.generationVersion ?? 1) !== (job.generation_version ?? 1) ||
    (job.generation_version === 2 &&
      JSON.stringify(revision.musicPreferences) !==
        JSON.stringify(JSON.parse(String(job.music_preferences_json))))
  )
    throw unavailable();
  const attempt = await env.DB.prepare(
    "SELECT output_key FROM provider_attempts WHERE id = ? AND owner_id = ? AND job_id = ? AND stage = 'music' AND status = 'succeeded'",
  )
    .bind(`music-${job.id}`, job.owner_id, job.id)
    .first<{ output_key: string | null }>();
  if (!attempt) throw unavailable();
  const resultKey = `results/${job.owner_id}/music-${job.id}.json`;
  if (attempt.output_key && attempt.output_key !== resultKey)
    throw unavailable();
  const object = await env.AUDIO.get(resultKey);
  if (!object) throw unavailable();
  const envelope = await object.json<{ version: number; value: SavedMusic }>();
  const saved = envelope.value;
  const blocks = JSON.parse(job.blocks_json);
  if (
    envelope.version !== 1 ||
    !saved ||
    typeof saved.returnedLyrics !== "string" ||
    !(job.generation_version === 2
      ? singingLyricsMatch(blocks, saved.returnedLyrics)
      : displayLyricsMatch(blocks, saved.returnedLyrics))
  )
    throw unavailable();
  const audio = await ownedAudio(env, saved.audioId, job.owner_id);
  const bytes = await env.AUDIO.head(saved.key);
  if (
    audio.kind !== "song" ||
    audio.draft_id !== job.draft_id ||
    audio.object_key !== saved.key ||
    saved.key !== `songs/${job.owner_id}/${job.id}.mp3` ||
    audio.mime_type !== saved.mimeType ||
    audio.size_bytes !== saved.sizeBytes ||
    !bytes ||
    bytes.size !== saved.sizeBytes
  )
    throw unavailable();
  return saved;
}
export async function musicRecoveryAvailable(env: Env, job: JobRow) {
  if (!["needs_reconciliation", "failed"].includes(job.status)) return false;
  try {
    await readSavedMusic(env, job);
    return true;
  } catch {
    return false;
  }
}
export async function recoverDraftMusic(
  env: Env,
  owner: string,
  draftId: string,
  jobId: string,
) {
  await assertAccountActive(env, owner);
  const draft = await ownedDraft(env, draftId, owner);
  const job = await ownedJob(env, jobId, owner);
  if (
    draft.job_id !== job.id ||
    job.draft_id !== draftId ||
    job.kind !== "generate"
  )
    throw new HttpError(409, "draft_job_conflict");
  if (job.status === "ready") return Response.json({ jobId: job.id });
  await readSavedMusic(env, job);
  if (job.status === "running" || job.status === "queued")
    return Response.json({ jobId: job.id }, { status: 202 });
  if (!["needs_reconciliation", "failed"].includes(job.status))
    throw new HttpError(409, "saved_music_unavailable");
  const result = await env.DB.batch([
    env.DB.prepare(
      "UPDATE jobs SET status = 'running', stage = 'recovering_music', error = NULL WHERE id = ? AND owner_id = ? AND status = ? AND EXISTS (SELECT 1 FROM provider_attempts WHERE job_id = jobs.id AND owner_id = jobs.owner_id AND stage = 'music' AND status = 'succeeded') AND NOT EXISTS (SELECT 1 FROM accounts WHERE uid = jobs.owner_id AND status != 'active') AND EXISTS (SELECT 1 FROM drafts WHERE id = ? AND owner_id = ? AND job_id = ? AND lyric_revision = ?)",
    ).bind(
      job.id,
      owner,
      job.status,
      draftId,
      owner,
      job.id,
      job.lyric_revision,
    ),
    env.DB.prepare(
      "UPDATE drafts SET status = 'generating', error = NULL WHERE id = ? AND owner_id = ? AND job_id = ? AND EXISTS (SELECT 1 FROM jobs WHERE id = ? AND status = 'running' AND stage = 'recovering_music')",
    ).bind(draftId, owner, job.id, job.id),
  ]);
  if (result[0].meta.changes !== 1) {
    const current = await ownedDraft(env, draftId, owner);
    const latest = await ownedJob(env, job.id, owner);
    if (
      current.job_id !== job.id ||
      !["running", "queued", "ready"].includes(latest.status)
    )
      throw new HttpError(409, "draft_job_conflict");
    return Response.json({ jobId: job.id }, { status: 202 });
  }
  try {
    await assertAccountActive(env, owner);
    const workflow = await env.GENERATE.get(job.id);
    await workflow.restart();
  } catch (error) {
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE jobs SET status = ?, stage = ?, error = ? WHERE id = ? AND owner_id = ? AND status = 'running' AND stage = 'recovering_music'",
      ).bind(job.status, job.stage, job.error, job.id, owner),
      env.DB.prepare(
        "UPDATE drafts SET status = ?, error = ? WHERE id = ? AND owner_id = ? AND job_id = ? AND EXISTS (SELECT 1 FROM jobs WHERE id = ? AND status = ?)",
      ).bind(
        draft.status,
        draft.error,
        draftId,
        owner,
        job.id,
        job.id,
        job.status,
      ),
    ]);
    throw error;
  }
  return Response.json({ jobId: job.id }, { status: 202 });
}

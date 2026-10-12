import { GOOGLE_MODELS } from "../pipeline/google.ts";
import type { MediaChunk, MediaInspection } from "../shared/contracts.ts";
import { assertAccountActive } from "./accounts.ts";
import {
  type ClipRow,
  clips,
  ownedDraft,
  ownedJob,
  setJob,
} from "./database.ts";
import { recoverTranscription } from "./providers.ts";
import { sha256 } from "./security.ts";
import { type Env, HttpError } from "./types.ts";

export async function transcriptionAttemptId(
  env: Env,
  clip: ClipRow,
  inspection: MediaInspection,
  chunk: MediaChunk,
) {
  const object = await env.AUDIO.head(chunk.key);
  if (!object) throw new HttpError(422, "media_chunk_missing");
  const fingerprint = await sha256(
    JSON.stringify({
      sourceEtag: inspection.sourceEtag,
      sourceSizeBytes: clip.size_bytes,
      transformVersion: inspection.transformVersion,
      chunkEtag: object.etag,
      chunkSizeBytes: object.size,
      offsetMs: chunk.offsetMs,
      durationMs: chunk.durationMs,
      model: GOOGLE_MODELS.transcribe,
      language: "ja-JP",
      timestampGranularities: ["WORD"],
    }),
  );
  return `stt-${clip.id}-${chunk.offsetMs}-${fingerprint.slice(0, 24)}`;
}

export async function recoverDraftTranscript(
  env: Env,
  owner: string,
  draftId: string,
) {
  await assertAccountActive(env, owner);
  const draft = await ownedDraft(env, draftId, owner);
  if (!draft.job_id)
    throw new HttpError(409, "saved_transcription_unavailable");
  const job = await ownedJob(env, draft.job_id, owner);
  if (
    job.draft_id !== draftId ||
    job.kind !== "prepare" ||
    job.status !== "needs_reconciliation"
  )
    throw new HttpError(409, "saved_transcription_unavailable");
  const attempts = (
    await env.DB.prepare(
      "SELECT id, runtime_claimed_at FROM provider_attempts WHERE job_id = ? AND owner_id = ? AND stage = 'transcribe' AND status = 'needs_reconciliation'",
    )
      .bind(job.id, owner)
      .all<{ id: string; runtime_claimed_at: string | null }>()
  ).results;
  if (
    !attempts.length ||
    attempts.some((attempt) => !attempt.runtime_claimed_at)
  )
    throw new HttpError(409, "saved_transcription_unavailable");
  const pending = new Set(attempts.map((attempt) => attempt.id));
  const recoveries: {
    attemptId: string;
    clipId: string;
    offsetMs: number;
    durationMs: number;
    cached: boolean;
  }[] = [];
  for (const clip of await clips(env, draftId, owner)) {
    if (!clip.inspection_json || clip.status !== "uploaded")
      throw new HttpError(409, "saved_transcription_unavailable");
    const inspection = JSON.parse(clip.inspection_json) as MediaInspection;
    const source = await env.AUDIO.head(clip.object_key);
    if (
      !source ||
      source.etag !== inspection.sourceEtag ||
      source.size !== clip.size_bytes ||
      inspection.sizeBytes !== clip.size_bytes
    )
      throw new HttpError(409, "saved_transcription_source_changed");
    for (const chunk of inspection.chunks) {
      const attemptId = await transcriptionAttemptId(
        env,
        clip,
        inspection,
        chunk,
      );
      if (!pending.has(attemptId)) continue;
      const cached = Boolean(
        await env.AUDIO.head(`results/${owner}/${attemptId}.json`),
      );
      if (
        !cached &&
        !(await env.AUDIO.head(`results/${owner}/${attemptId}.raw.json`))
      )
        throw new HttpError(409, "saved_transcription_unavailable");
      recoveries.push({
        attemptId,
        clipId: clip.id,
        offsetMs: chunk.offsetMs,
        durationMs: Math.min(
          chunk.durationMs,
          inspection.durationMs - chunk.offsetMs,
        ),
        cached,
      });
    }
  }
  if (recoveries.length !== attempts.length)
    throw new HttpError(409, "saved_transcription_source_changed");
  const locked = await env.DB.prepare(
    "UPDATE jobs SET status = 'running', stage = 'recovering_transcription', error = NULL WHERE id = ? AND owner_id = ? AND status = 'needs_reconciliation'",
  )
    .bind(job.id, owner)
    .run();
  if (locked.meta.changes !== 1)
    throw new HttpError(409, "saved_transcription_unavailable");
  try {
    for (const { attemptId, cached, ...input } of recoveries) {
      if (!cached) await recoverTranscription(env, attemptId, input);
    }
    await assertAccountActive(env, owner);
    const current = await ownedDraft(env, draftId, owner);
    if (current.job_id !== job.id)
      throw new HttpError(409, "draft_job_conflict");
    await setJob(env, job, "queued", "recovering_transcription");
    const instance = await env.PREPARE.get(job.id);
    await instance.restart();
    return Response.json({ accepted: true }, { status: 202 });
  } catch (error) {
    await assertAccountActive(env, owner);
    const restored = await env.DB.prepare(
      "UPDATE jobs SET status = 'needs_reconciliation', stage = 'stopped', error = 'provider_outcome_unconfirmed' WHERE id = ? AND owner_id = ? AND status IN ('running', 'queued') AND stage = 'recovering_transcription'",
    )
      .bind(job.id, owner)
      .run();
    if (restored.meta.changes === 1)
      await env.DB.prepare(
        "UPDATE drafts SET status = 'needs_reconciliation', error = 'provider_outcome_unconfirmed' WHERE id = ? AND owner_id = ? AND job_id = ?",
      )
        .bind(draftId, owner, job.id)
        .run();
    throw error;
  }
}

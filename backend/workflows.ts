import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import {
  type LyricBlock,
  MAX_AUDIO_MS,
  type RegisteredSpeaker,
} from "../shared/contracts.ts";
import {
  clips,
  type JobRow,
  lyrics,
  ownedDraft,
  ownedJob,
  setJob,
  utterances,
} from "./database.ts";
import { identifySpeakersInChunk, inspectClip, probeSong } from "./media.ts";
import { paidCall, RESERVATION_USD } from "./paid.ts";
import type { SavedMusic } from "./providers.ts";
import { createLyrics, generateMusic, transcribeAudio } from "./providers.ts";
import { sha256 } from "./security.ts";
import {
  type Env,
  HttpError,
  ReconciliationError,
  type WorkflowParams,
} from "./types.ts";
import { validateBlocks, validateUtterances } from "./validation.ts";

const paidStep = {
  retries: { limit: 0, delay: "1 second" },
  timeout: "15 minutes",
} as const;
const mediaStep = {
  retries: { limit: 2, delay: "10 seconds", backoff: "exponential" },
  timeout: "15 minutes",
} as const;
const knownStepErrors = new Set([
  "ai_budget_exhausted",
  "invalid_ai_budget",
  "provider_cost_exceeded_reservation",
  "provider_input_rejected",
  "media_inspection_failed",
  "invalid_media_inspection",
  "invalid_media_chunk",
  "media_chunk_missing",
  "invalid_generated_audio",
  "speaker_identification_failed",
  "invalid_speaker_matches",
  "invalid_speaker_audio_url",
  "speaker_audio_download_failed",
  "speaker_audio_too_large",
  "speaker_audio_empty",
  "speaker_audio_invalid",
  "speaker_sample_too_short",
  "speaker_sample_silent",
  "invalid_speaker_embedding",
]);

async function failure(env: Env, job: JobRow, error: unknown) {
  const pending = await env.DB.prepare(
    "SELECT id FROM provider_attempts WHERE job_id = ? AND owner_id = ? AND status IN ('submitted', 'needs_reconciliation') LIMIT 1",
  )
    .bind(job.id, job.owner_id)
    .first();
  const message =
    typeof error === "string"
      ? error
      : error &&
          typeof error === "object" &&
          "message" in error &&
          typeof error.message === "string"
        ? error.message
        : "";
  const uncertain =
    error instanceof ReconciliationError ||
    message.includes("needs_reconciliation") ||
    Boolean(pending);
  const code = uncertain
    ? "provider_outcome_unconfirmed"
    : error instanceof HttpError
      ? error.code
      : knownStepErrors.has(message)
        ? message
        : "generation_failed";
  await setJob(
    env,
    job,
    uncertain ? "needs_reconciliation" : "failed",
    "stopped",
    code,
  );
}

async function saveLyrics(env: Env, job: JobRow, blocks: LyricBlock[]) {
  const draft = await ownedDraft(env, job.draft_id, job.owner_id);
  if (draft.job_id !== job.id) throw new HttpError(409, "draft_job_conflict");
  const current = await lyrics(env, draft.id, draft.lyric_revision);
  if (current && JSON.stringify(current.blocks) === JSON.stringify(blocks))
    return current.revision;
  const revision = draft.lyric_revision + 1;
  await env.DB.batch([
    env.DB.prepare(
      "INSERT OR IGNORE INTO lyric_revisions (draft_id, revision, blocks_json, created_at) VALUES (?, ?, ?, ?)",
    ).bind(
      draft.id,
      revision,
      JSON.stringify(blocks),
      new Date().toISOString(),
    ),
    env.DB.prepare(
      "UPDATE drafts SET lyric_revision = ? WHERE id = ? AND owner_id = ? AND job_id = ?",
    ).bind(revision, draft.id, job.owner_id, job.id),
  ]);
  return revision;
}

export async function prepareDraft(
  env: Env,
  jobId: string,
  step: WorkflowStep,
) {
  const job = await ownedJob(env, jobId, env.OWNER_ID);
  if (job.kind !== "prepare") throw new HttpError(409, "wrong_workflow_kind");
  if (["waiting_review", "ready", "needs_reconciliation"].includes(job.status))
    return;
  try {
    await step.do("start", () => setJob(env, job, "running", "inspect_audio"));
    const sourceClips = await clips(env, job.draft_id, job.owner_id);
    const inspected = [];
    let totalMs = 0;
    for (const clip of sourceClips) {
      if (clip.status !== "uploaded")
        throw new HttpError(409, "audio_upload_incomplete");
      const inspection = await step.do(`inspect-${clip.id}`, mediaStep, () =>
        inspectClip(env, job, clip),
      );
      totalMs += inspection.durationMs;
      if (totalMs > MAX_AUDIO_MS)
        throw new HttpError(422, "audio_duration_limit");
      inspected.push({ clip, inspection });
    }
    if (!inspected.length) throw new HttpError(422, "empty_audio");
    await setJob(env, job, "running", "transcribing");
    for (const { clip, inspection } of inspected) {
      for (const [index, chunk] of inspection.chunks.entries()) {
        await step.do(
          `transcribe-${clip.id}-${chunk.offsetMs}`,
          paidStep,
          async () => {
            const transcript = await paidCall(
              env,
              job,
              `stt-${clip.id}-${chunk.offsetMs}`,
              "transcribe",
              RESERVATION_USD.transcribe,
              async () => {
                const result = await transcribeAudio(
                  env,
                  job,
                  `stt-${clip.id}-${chunk.offsetMs}`,
                  {
                    clipId: clip.id,
                    index,
                    offsetMs: chunk.offsetMs,
                  },
                );
                const values = validateUtterances(
                  result.value,
                  clip.id,
                  inspection.durationMs,
                );
                if (
                  values.some(
                    (item) =>
                      item.startMs < chunk.offsetMs ||
                      item.endMs > chunk.offsetMs + chunk.durationMs,
                  )
                )
                  throw new ReconciliationError();
                return {
                  value: values,
                  costUsd: result.costUsd,
                  usage: result.usage,
                };
              },
            );
            validateUtterances(transcript, clip.id, inspection.durationMs);
            if (
              transcript.some(
                (item) =>
                  item.startMs < chunk.offsetMs ||
                  item.endMs > chunk.offsetMs + chunk.durationMs,
              )
            )
              throw new ReconciliationError();
            if (transcript.length)
              await env.DB.prepare(
                "INSERT OR IGNORE INTO utterances (id, clip_id, start_ms, end_ms, speaker, text) SELECT json_extract(value, '$.id'), json_extract(value, '$.clipId'), json_extract(value, '$.startMs'), json_extract(value, '$.endMs'), json_extract(value, '$.speaker'), json_extract(value, '$.text') FROM json_each(?)",
              )
                .bind(JSON.stringify(transcript))
                .run();
            return true;
          },
        );
      }
    }
    const snapshot = job.speaker_snapshot_json
      ? (JSON.parse(job.speaker_snapshot_json) as RegisteredSpeaker[])
      : [];
    if (snapshot.length) {
      for (const { clip, inspection } of inspected) {
        for (const [index, chunk] of inspection.chunks.entries()) {
          const candidates = (
            await utterances(env, job.draft_id, job.owner_id)
          ).filter(
            (item) =>
              item.clipId === clip.id &&
              item.startMs >= chunk.offsetMs &&
              item.endMs <= chunk.offsetMs + chunk.durationMs,
          );
          if (!candidates.length) continue;
          const matches = await step.do(
            `identify-${clip.id}-${chunk.offsetMs}`,
            mediaStep,
            () =>
              identifySpeakersInChunk(env, job, clip, {
                index,
                offsetMs: chunk.offsetMs,
                durationMs: chunk.durationMs,
                utterances: candidates.map(({ speaker, startMs, endMs }) => ({
                  speaker,
                  startMs,
                  endMs,
                })),
                profiles: snapshot,
              }),
          );
          for (const match of matches) {
            if (!match.speakerProfileId) continue;
            const profile = snapshot.find(
              (item) => item.id === match.speakerProfileId,
            );
            if (!profile) throw new HttpError(502, "invalid_speaker_matches");
            await env.DB.prepare(
              "UPDATE utterances SET speaker_profile_id = ?, speaker_name = ? WHERE clip_id = ? AND speaker = ? AND start_ms >= ? AND end_ms <= ?",
            )
              .bind(
                profile.id,
                profile.name,
                clip.id,
                match.speaker,
                chunk.offsetMs,
                chunk.offsetMs + chunk.durationMs,
              )
              .run();
          }
        }
      }
    }
    const source = await utterances(env, job.draft_id, job.owner_id);
    if (!source.length) throw new HttpError(422, "no_speech_detected");
    await setJob(env, job, "running", "creating_lyrics");
    const sourceHash = await sha256(JSON.stringify(source));
    const blocks = await step.do("create_lyrics", paidStep, () =>
      paidCall(
        env,
        job,
        `lyrics-${job.draft_id}-${sourceHash}`,
        "lyrics",
        RESERVATION_USD.lyrics,
        async () => {
          const result = await createLyrics(
            env,
            job,
            `lyrics-${job.draft_id}-${sourceHash}`,
            { utterances: source },
          );
          return {
            value: validateBlocks(result.value, source),
            costUsd: result.costUsd,
            usage: result.usage,
          };
        },
      ),
    );
    validateBlocks(blocks, source);
    await step.do("save_lyrics", () => saveLyrics(env, job, blocks));
    await step.do("waiting_review", () =>
      setJob(env, job, "waiting_review", "review_lyrics"),
    );
  } catch (error) {
    await failure(env, job, error);
  }
}

export function lyricsMatch(blocks: LyricBlock[], returned: string) {
  const clean = (value: string) =>
    value
      .replace(/\[[^\]]*\]/g, "")
      .replace(/^[\s#*>-]+/gm, "")
      .replace(/[\p{P}\p{S}\s]/gu, "")
      .normalize("NFKC");
  return (
    clean(blocks.map((block) => block.text).join("\n")) === clean(returned)
  );
}

export async function generateSong(
  env: Env,
  jobId: string,
  step: WorkflowStep,
) {
  const job = await ownedJob(env, jobId, env.OWNER_ID);
  if (job.kind !== "generate" || !job.blocks_json || !job.lyric_revision)
    throw new HttpError(409, "wrong_workflow_kind");
  if (["ready", "needs_reconciliation"].includes(job.status)) return;
  try {
    await step.do("start", () =>
      setJob(env, job, "running", "generating_music"),
    );
    const blocks = validateBlocks(
      JSON.parse(job.blocks_json),
      await utterances(env, job.draft_id, job.owner_id),
    );
    const saved = await step.do("generate_music", paidStep, () =>
      paidCall<SavedMusic>(
        env,
        job,
        `music-${job.id}`,
        "music",
        RESERVATION_USD.music,
        () => generateMusic(env, job, `music-${job.id}`, { blocks }),
      ),
    );
    if (!lyricsMatch(blocks, saved.returnedLyrics)) {
      await setJob(
        env,
        job,
        "needs_reconciliation",
        "check_generated_lyrics",
        "generated_lyrics_differ",
      );
      return;
    }
    await setJob(env, job, "running", "inspect_generated_audio");
    const inspection = await step.do("probe_song", mediaStep, () =>
      probeSong(env, job, saved.audioId),
    );
    if (inspection.sizeBytes !== saved.sizeBytes)
      throw new HttpError(422, "generated_audio_size_mismatch");
    const songId = `song-${job.id}`;
    await step.do("save_song", async () => {
      const draft = await ownedDraft(env, job.draft_id, job.owner_id);
      await env.DB.batch([
        env.DB.prepare(
          "UPDATE audio_objects SET duration_ms = ? WHERE id = ? AND owner_id = ?",
        ).bind(inspection.durationMs, saved.audioId, job.owner_id),
        env.DB.prepare(
          "INSERT OR IGNORE INTO songs (id, owner_id, draft_id, title, created_at, lyric_revision, audio_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
        ).bind(
          songId,
          job.owner_id,
          job.draft_id,
          draft.title,
          new Date().toISOString(),
          job.lyric_revision,
          saved.audioId,
        ),
      ]);
      return songId;
    });
    await step.do("ready", () =>
      setJob(env, job, "ready", "complete", null, songId),
    );
  } catch (error) {
    await failure(env, job, error);
  }
}

export class PrepareWorkflow extends WorkflowEntrypoint<Env, WorkflowParams> {
  async run(event: WorkflowEvent<WorkflowParams>, step: WorkflowStep) {
    await prepareDraft(this.env, event.payload.jobId, step);
  }
}
export class GenerateWorkflow extends WorkflowEntrypoint<Env, WorkflowParams> {
  async run(event: WorkflowEvent<WorkflowParams>, step: WorkflowStep) {
    await generateSong(this.env, event.payload.jobId, step);
  }
}

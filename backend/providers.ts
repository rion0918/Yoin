import type { LyricBlock, Utterance } from "../shared/contracts.ts";
import type { JobRow } from "./database.ts";
import { callMedia } from "./media.ts";
import { signedUrl } from "./security.ts";
import type { Env } from "./types.ts";

type Output<T> = { value: T; costUsd: number; usage: unknown };
export type SavedMusic = {
  audioId: string;
  key: string;
  mimeType: string;
  sizeBytes: number;
  returnedLyrics: string;
};

async function targets(env: Env, attemptId: string) {
  const origin = env.MEDIA_API_URL ?? env.PUBLIC_API_URL;
  const base = `/internal/attempts/${attemptId}`;
  const claim = await signedUrl(env, `${base}/claim`, "POST", 3600, origin);
  const result = await signedUrl(env, `${base}/result`, "PUT", 3600, origin);
  const raw = await signedUrl(env, `${base}/raw`, "PUT", 3600, origin);
  return { claimUrl: claim.url, resultUrl: result.url, rawUrl: raw.url };
}

export async function transcribeAudio(
  env: Env,
  job: JobRow,
  attemptId: string,
  input: { clipId: string; index: number; offsetMs: number },
) {
  const source = await signedUrl(
    env,
    `/internal/chunks/${job.id}/${input.clipId}/${input.index}`,
    "GET",
    3600,
    env.MEDIA_API_URL ?? env.PUBLIC_API_URL,
  );
  return callMedia<Output<Utterance[]>>(env, "/transcribe", {
    ...(await targets(env, attemptId)),
    sourceUrl: source.url,
    clipId: input.clipId,
    offsetMs: input.offsetMs,
  });
}

export async function createLyrics(
  env: Env,
  _job: JobRow,
  attemptId: string,
  input: { utterances: Utterance[] },
) {
  return callMedia<Output<LyricBlock[]>>(env, "/lyrics", {
    ...(await targets(env, attemptId)),
    ...input,
  });
}

export async function generateMusic(
  env: Env,
  _job: JobRow,
  attemptId: string,
  input: { blocks: LyricBlock[] },
) {
  const song = await signedUrl(
    env,
    `/internal/attempts/${attemptId}/song`,
    "PUT",
    3600,
    env.MEDIA_API_URL ?? env.PUBLIC_API_URL,
  );
  return callMedia<Output<SavedMusic>>(env, "/music", {
    ...(await targets(env, attemptId)),
    songUploadUrl: song.url,
    ...input,
  });
}

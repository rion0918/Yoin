import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import type { Env, MemoryDeletionParams } from "./types.ts";

type MemoryJob = { id: string; kind: "prepare" | "generate" | "readings" };
type MemoryClip = {
  id: string;
  object_key: string;
  upload_id: string | null;
  status: string;
};
type MemoryAttempt = { id: string; output_key: string | null };

function workflowNotFound(error: unknown) {
  return (
    error instanceof Error &&
    (error.message === "instance.not_found" ||
      error.message.endsWith("(instance.not_found)"))
  );
}

function multipartUploadMissing(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const value = error as { name?: unknown; code?: unknown };
  return value.name === "NoSuchUpload" || value.code === "NoSuchUpload";
}

async function deleteWorkflow(
  workflow: Env["PREPARE"] | Env["GENERATE"],
  id: string,
) {
  try {
    const instance = await workflow.get(id);
    if ((await instance.status()).status !== "unknown") await instance.delete();
  } catch (error) {
    if (!workflowNotFound(error)) throw error;
  }
}

async function deletePrefix(env: Env, prefix: string) {
  let cursor: string | undefined;
  do {
    const listing = await env.AUDIO.list({ prefix, cursor });
    if (listing.objects.length)
      await env.AUDIO.delete(listing.objects.map((object) => object.key));
    cursor = listing.truncated ? listing.cursor : undefined;
  } while (cursor);
}

export async function deleteMemoryData(
  env: Env,
  { uid, draftId }: MemoryDeletionParams,
) {
  const jobs = (
    await env.DB.prepare(
      "SELECT id, kind FROM jobs WHERE owner_id = ? AND draft_id = ?",
    )
      .bind(uid, draftId)
      .all<MemoryJob>()
  ).results;
  const clips = (
    await env.DB.prepare(
      "SELECT id, object_key, upload_id, status FROM clips WHERE owner_id = ? AND draft_id = ?",
    )
      .bind(uid, draftId)
      .all<MemoryClip>()
  ).results;
  const attempts = (
    await env.DB.prepare(
      "SELECT p.id, p.output_key FROM provider_attempts p JOIN jobs j ON j.id = p.job_id AND j.owner_id = p.owner_id WHERE p.owner_id = ? AND j.draft_id = ?",
    )
      .bind(uid, draftId)
      .all<MemoryAttempt>()
  ).results;
  const audioObjects = (
    await env.DB.prepare(
      "SELECT object_key FROM audio_objects WHERE owner_id = ? AND draft_id = ?",
    )
      .bind(uid, draftId)
      .all<{ object_key: string }>()
  ).results;

  for (const job of jobs)
    await deleteWorkflow(
      job.kind === "generate" ? env.GENERATE : env.PREPARE,
      job.id,
    );
  for (const clip of clips) {
    if (clip.upload_id && clip.status !== "uploaded") {
      try {
        await env.AUDIO.resumeMultipartUpload(
          clip.object_key,
          clip.upload_id,
        ).abort();
      } catch (error) {
        if (!multipartUploadMissing(error)) throw error;
      }
    }
    await env.AUDIO.delete(clip.object_key);
  }
  for (const job of jobs) {
    await deletePrefix(env, `processed/${uid}/${job.id}/`);
    await env.AUDIO.delete(`songs/${uid}/${job.id}.mp3`);
  }
  for (const attempt of attempts) {
    await env.AUDIO.delete([
      `results/${uid}/${attempt.id}.json`,
      `results/${uid}/${attempt.id}.raw.json`,
    ]);
    if (attempt.output_key) await env.AUDIO.delete(attempt.output_key);
  }
  for (const audio of audioObjects) await env.AUDIO.delete(audio.object_key);
  await deletePrefix(env, `locations/${uid}/${draftId}/`);

  await env.DB.batch([
    env.DB.prepare(
      "DELETE FROM upload_parts WHERE clip_id IN (SELECT id FROM clips WHERE owner_id = ? AND draft_id = ?)",
    ).bind(uid, draftId),
    env.DB.prepare(
      "DELETE FROM utterances WHERE clip_id IN (SELECT id FROM clips WHERE owner_id = ? AND draft_id = ?)",
    ).bind(uid, draftId),
    env.DB.prepare(
      "DELETE FROM lyric_revisions WHERE draft_id = ? AND EXISTS (SELECT 1 FROM drafts WHERE id = ? AND owner_id = ?)",
    ).bind(draftId, draftId, uid),
    env.DB.prepare(
      "DELETE FROM songs WHERE owner_id = ? AND draft_id = ?",
    ).bind(uid, draftId),
    env.DB.prepare(
      "DELETE FROM audio_objects WHERE owner_id = ? AND draft_id = ?",
    ).bind(uid, draftId),
    env.DB.prepare(
      "DELETE FROM provider_attempts WHERE owner_id = ? AND job_id IN (SELECT id FROM jobs WHERE owner_id = ? AND draft_id = ?)",
    ).bind(uid, uid, draftId),
    env.DB.prepare("DELETE FROM jobs WHERE owner_id = ? AND draft_id = ?").bind(
      uid,
      draftId,
    ),
    env.DB.prepare(
      "DELETE FROM clips WHERE owner_id = ? AND draft_id = ?",
    ).bind(uid, draftId),
    env.DB.prepare("DELETE FROM drafts WHERE owner_id = ? AND id = ?").bind(
      uid,
      draftId,
    ),
    env.DB.prepare(
      "UPDATE memory_deletions SET status = 'deleted', error = NULL, deleted_at = ? WHERE owner_id = ? AND draft_id = ?",
    ).bind(new Date().toISOString(), uid, draftId),
  ]);
}

export class DeleteMemoryWorkflow extends WorkflowEntrypoint<
  Env,
  MemoryDeletionParams
> {
  async run(event: WorkflowEvent<MemoryDeletionParams>, step: WorkflowStep) {
    try {
      await step.do(
        "delete memory data",
        {
          retries: { limit: 10, delay: "1 minute", backoff: "exponential" },
          timeout: "15 minutes",
        },
        () => deleteMemoryData(this.env, event.payload),
      );
    } catch {
      await this.env.DB.prepare(
        "UPDATE memory_deletions SET status = 'failed', error = 'deletion_cleanup_failed' WHERE owner_id = ? AND draft_id = ? AND workflow_id = ? AND status = 'deleting'",
      )
        .bind(event.payload.uid, event.payload.draftId, event.instanceId)
        .run();
      throw new Error("memory_deletion_failed");
    }
    await (await this.env.DELETE_MEMORY.get(event.instanceId)).delete();
  }
}

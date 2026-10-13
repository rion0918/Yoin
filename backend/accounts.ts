import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import { callMedia } from "./media.ts";
import { type Identity, sha256 } from "./security.ts";
import { type Env, HttpError } from "./types.ts";

type Account = {
  status: "active" | "deleting" | "deleted";
  deletion_requested_at: string | null;
  deleted_at: string | null;
};
export async function accountState(env: Env, uid: string) {
  return env.DB.prepare(
    "SELECT status, deletion_requested_at, deleted_at FROM accounts WHERE uid = ?",
  )
    .bind(uid)
    .first<Account>();
}
export async function assertAccountActive(env: Env, uid: string) {
  const account = await accountState(env, uid);
  if (account && account.status !== "active")
    throw new HttpError(403, "account_deleted");
}
export async function assertMemoryActive(
  env: Env,
  uid: string,
  draftId: string,
) {
  const deletion = await env.DB.prepare(
    "SELECT status FROM memory_deletions WHERE owner_id = ? AND draft_id = ?",
  )
    .bind(uid, draftId)
    .first<{ status: string }>();
  if (deletion) throw new HttpError(409, "memory_deleted");
}
export async function resourceOwner(
  env: Env,
  table: "audio_objects" | "jobs" | "speaker_samples",
  id: string,
) {
  const row = await env.DB.prepare(`SELECT owner_id FROM ${table} WHERE id = ?`)
    .bind(id)
    .first<{ owner_id: string }>();
  if (!row) throw new HttpError(404, "resource_not_found");
  await assertAccountActive(env, row.owner_id);
  return row.owner_id;
}
export async function finishOwnedUpload(
  env: Env,
  owner: string,
  key: string,
  draftId?: string,
) {
  try {
    await assertAccountActive(env, owner);
    if (draftId) await assertMemoryActive(env, owner, draftId);
  } catch (error) {
    await env.AUDIO.delete(key);
    throw error;
  }
}

function memoryWorkflowId() {
  return `memory-${crypto.randomUUID()}`;
}

export async function requestMemoryDeletion(
  env: Env,
  owner: string,
  draftId: string,
) {
  const workflowId = memoryWorkflowId();
  await env.DB.prepare(
    "INSERT OR IGNORE INTO memory_deletions (owner_id, draft_id, workflow_id, status, requested_at) SELECT ?, ?, ?, 'deleting', ? WHERE EXISTS (SELECT 1 FROM drafts WHERE id = ? AND owner_id = ?)",
  )
    .bind(owner, draftId, workflowId, new Date().toISOString(), draftId, owner)
    .run();

  let deletion = await env.DB.prepare(
    "SELECT workflow_id, status FROM memory_deletions WHERE owner_id = ? AND draft_id = ?",
  )
    .bind(owner, draftId)
    .first<{
      workflow_id: string;
      status: "deleting" | "failed" | "deleted";
    }>();
  if (!deletion) throw new HttpError(404, "draft_not_found");
  if (deletion.status === "deleted")
    return Response.json({ status: "deleted" });

  if (deletion.status === "failed") {
    await env.DB.prepare(
      "UPDATE memory_deletions SET workflow_id = ?, status = 'deleting', error = NULL, requested_at = ?, deleted_at = NULL WHERE owner_id = ? AND draft_id = ? AND status = 'failed'",
    )
      .bind(memoryWorkflowId(), new Date().toISOString(), owner, draftId)
      .run();
    deletion = await env.DB.prepare(
      "SELECT workflow_id, status FROM memory_deletions WHERE owner_id = ? AND draft_id = ?",
    )
      .bind(owner, draftId)
      .first<{
        workflow_id: string;
        status: "deleting" | "failed" | "deleted";
      }>();
    if (!deletion) throw new HttpError(500, "memory_deletion_failed");
    if (deletion.status === "deleted")
      return Response.json({ status: "deleted" });
  }

  try {
    await env.DELETE_MEMORY.create({
      id: deletion.workflow_id,
      params: { uid: owner, draftId },
    });
  } catch (error) {
    try {
      const existing = await env.DELETE_MEMORY.get(deletion.workflow_id);
      const status = await existing.status();
      if (status.status === "unknown") throw error;
      if (status.status === "errored" || status.status === "terminated")
        await existing.restart();
    } catch (lookupError) {
      const current = await env.DB.prepare(
        "UPDATE memory_deletions SET status = 'failed', error = 'deletion_dispatch_failed' WHERE owner_id = ? AND draft_id = ? AND workflow_id = ? AND status = 'deleting'",
      )
        .bind(owner, draftId, deletion.workflow_id)
        .run();
      if (current.meta.changes)
        throw new HttpError(503, "memory_deletion_failed");
      throw error ?? lookupError;
    }
  }
  return Response.json({ status: "deleting" }, { status: 202 });
}

export async function memoryDeletionStatus(
  env: Env,
  owner: string,
  draftId: string,
) {
  const deletion = await env.DB.prepare(
    "SELECT status FROM memory_deletions WHERE owner_id = ? AND draft_id = ?",
  )
    .bind(owner, draftId)
    .first<{ status: "deleting" | "failed" | "deleted" }>();
  if (!deletion) throw new HttpError(404, "draft_not_found");
  return Response.json({ status: deletion.status });
}
export async function memoryDeletionIds(env: Env, owner: string) {
  const deletions = await env.DB.prepare(
    "SELECT draft_id FROM memory_deletions WHERE owner_id = ? ORDER BY draft_id",
  )
    .bind(owner)
    .all<{ draft_id: string }>();
  return Response.json({
    draftIds: deletions.results.map((deletion) => deletion.draft_id),
  });
}
export async function getAccount(env: Env, identity: Identity) {
  await env.DB.prepare("INSERT OR IGNORE INTO accounts (uid) VALUES (?)")
    .bind(identity.uid)
    .run();
  return Response.json({
    uid: identity.uid,
    email: identity.email,
    name: identity.name,
    status: (await accountState(env, identity.uid))?.status ?? "active",
  });
}
export async function requestDeletion(env: Env, identity: Identity) {
  const account = await accountState(env, identity.uid);
  if (account?.status === "deleted")
    return Response.json({ status: "deleted" }, { status: 202 });
  if (!account || account.status === "active") {
    if (Math.floor(Date.now() / 1000) - identity.authTime > 300)
      throw new HttpError(401, "recent_login_required");
    await env.DB.prepare(
      "INSERT INTO accounts (uid, status, deletion_requested_at) VALUES (?, 'deleting', ?) ON CONFLICT(uid) DO UPDATE SET status = 'deleting', deletion_requested_at = excluded.deletion_requested_at WHERE accounts.status = 'active'",
    )
      .bind(identity.uid, new Date().toISOString())
      .run();
  }
  const id = `delete-${await sha256(identity.uid)}`;
  try {
    await env.DELETE_ACCOUNT.create({ id, params: { uid: identity.uid } });
  } catch (error) {
    const existing = await env.DELETE_ACCOUNT.get(id).catch(() => {
      throw error;
    });
    const status = await existing.status();
    if (status.status === "unknown") throw error;
    if (status.status === "errored") await existing.restart();
  }
  return Response.json({ status: "deleting" }, { status: 202 });
}
export async function deleteAccountData(env: Env, uid: string) {
  const jobs = (
    await env.DB.prepare("SELECT id, kind FROM jobs WHERE owner_id = ?")
      .bind(uid)
      .all<{ id: string; kind: string }>()
  ).results;
  for (const job of jobs) {
    const workflow = job.kind === "generate" ? env.GENERATE : env.PREPARE;
    // Completed and in-flight Workflow results both contain private audio/lyrics.
    try {
      const instance = await workflow.get(job.id);
      if ((await instance.status()).status !== "unknown")
        await instance.delete();
    } catch (error) {
      if (
        !(error instanceof Error) ||
        (error.message !== "instance.not_found" &&
          !error.message.endsWith("(instance.not_found)"))
      )
        throw error;
    }
  }
  const memoryWorkflows = (
    await env.DB.prepare(
      "SELECT workflow_id FROM memory_deletions WHERE owner_id = ? AND status != 'deleted'",
    )
      .bind(uid)
      .all<{ workflow_id: string }>()
  ).results;
  for (const deletion of memoryWorkflows) {
    try {
      const instance = await env.DELETE_MEMORY.get(deletion.workflow_id);
      if ((await instance.status()).status !== "unknown")
        await instance.delete();
    } catch (error) {
      if (
        !(error instanceof Error) ||
        (error.message !== "instance.not_found" &&
          !error.message.endsWith("(instance.not_found)"))
      )
        throw error;
    }
  }
  await callMedia(env, "/accounts/delete", { uid });
  const clips = (
    await env.DB.prepare(
      "SELECT object_key, upload_id FROM clips WHERE owner_id = ? AND upload_id IS NOT NULL AND status != 'uploaded'",
    )
      .bind(uid)
      .all<{ object_key: string; upload_id: string }>()
  ).results;
  for (const clip of clips)
    await env.AUDIO.resumeMultipartUpload(
      clip.object_key,
      clip.upload_id,
    ).abort();
  for (const category of [
    "originals",
    "processed",
    "voices",
    "songs",
    "results",
    "locations",
  ]) {
    let cursor: string | undefined;
    do {
      const listing = await env.AUDIO.list({
        prefix: `${category}/${uid}/`,
        cursor,
      });
      if (listing.objects.length)
        await env.AUDIO.delete(listing.objects.map((object) => object.key));
      cursor = listing.truncated ? listing.cursor : undefined;
    } while (cursor);
  }
  await env.DB.batch([
    env.DB.prepare("DELETE FROM memory_deletions WHERE owner_id = ?").bind(uid),
    env.DB.prepare(
      "DELETE FROM upload_parts WHERE clip_id IN (SELECT id FROM clips WHERE owner_id = ?)",
    ).bind(uid),
    env.DB.prepare(
      "DELETE FROM utterances WHERE clip_id IN (SELECT id FROM clips WHERE owner_id = ?)",
    ).bind(uid),
    env.DB.prepare(
      "DELETE FROM lyric_revisions WHERE draft_id IN (SELECT id FROM drafts WHERE owner_id = ?)",
    ).bind(uid),
    env.DB.prepare("DELETE FROM songs WHERE owner_id = ?").bind(uid),
    env.DB.prepare("DELETE FROM audio_objects WHERE owner_id = ?").bind(uid),
    env.DB.prepare("DELETE FROM provider_attempts WHERE owner_id = ?").bind(
      uid,
    ),
    env.DB.prepare("DELETE FROM jobs WHERE owner_id = ?").bind(uid),
    env.DB.prepare("DELETE FROM clips WHERE owner_id = ?").bind(uid),
    env.DB.prepare("DELETE FROM drafts WHERE owner_id = ?").bind(uid),
    env.DB.prepare("DELETE FROM speaker_profiles WHERE owner_id = ?").bind(uid),
    env.DB.prepare(
      "UPDATE accounts SET status = 'deleted', deleted_at = ? WHERE uid = ?",
    ).bind(new Date().toISOString(), uid),
  ]);
}
export class DeleteAccountWorkflow extends WorkflowEntrypoint<
  Env,
  { uid: string }
> {
  async run(event: WorkflowEvent<{ uid: string }>, step: WorkflowStep) {
    await step.do(
      "delete account and content",
      {
        retries: { limit: 10, delay: "1 minute", backoff: "exponential" },
        timeout: "15 minutes",
      },
      () => deleteAccountData(this.env, event.payload.uid),
    );
    await step.sleep("reject old identity tokens", "24 hours");
    await step.do("remove deletion marker", async () => {
      await this.env.DB.prepare(
        "DELETE FROM accounts WHERE uid = ? AND status = 'deleted'",
      )
        .bind(event.payload.uid)
        .run();
    });
    await (await this.env.DELETE_ACCOUNT.get(event.instanceId)).delete();
  }
}

import { MAX_AUDIO_BYTES } from "../shared/contracts.ts";
import { assertAccountActive, finishOwnedUpload } from "./accounts.ts";
import { ownedJob } from "./database.ts";
import { fixedBody } from "./media-api.ts";
import { verifySignedUrl } from "./security.ts";
import { type Env, HttpError } from "./types.ts";
import { integer } from "./validation.ts";

export async function runtimeCallback(
  request: Request,
  env: Env,
  attemptId: string,
  action: string,
) {
  await verifySignedUrl(request, env);
  const attempt = await env.DB.prepare(
    "SELECT job_id, owner_id, stage, status, runtime_claimed_at FROM provider_attempts WHERE id = ?",
  )
    .bind(attemptId)
    .first<{
      job_id: string;
      owner_id: string;
      stage: string;
      status: string;
      runtime_claimed_at: string | null;
    }>();
  if (
    !attempt ||
    !["submitted", "needs_reconciliation"].includes(attempt.status)
  )
    throw new HttpError(409, "invalid_runtime_attempt");
  await assertAccountActive(env, attempt.owner_id);
  const job = await ownedJob(env, attempt.job_id, attempt.owner_id);
  if (action === "claim") {
    if (
      job.status !== "running" ||
      attempt.status !== "submitted" ||
      (attempt.stage === "music"
        ? job.kind !== "generate"
        : job.kind !== "prepare")
    )
      throw new HttpError(409, "invalid_runtime_job");
    const claimed = await env.DB.prepare(
      "UPDATE provider_attempts SET runtime_claimed_at = ? WHERE id = ? AND owner_id = ? AND status = 'submitted' AND runtime_claimed_at IS NULL",
    )
      .bind(new Date().toISOString(), attemptId, attempt.owner_id)
      .run();
    if (claimed.meta.changes !== 1)
      throw new HttpError(409, "runtime_attempt_already_claimed");
    return Response.json({ stage: attempt.stage });
  }
  if (
    !attempt.runtime_claimed_at ||
    !["running", "needs_reconciliation"].includes(job.status)
  )
    throw new HttpError(409, "invalid_runtime_job");
  const size = integer(
    Number(request.headers.get("content-length")),
    1,
    action === "song" || action === "raw" ? MAX_AUDIO_BYTES : 4 * 1024 * 1024,
  );
  if (action === "song") {
    if (attempt.stage !== "music" || job.kind !== "generate")
      throw new HttpError(409, "invalid_runtime_stage");
    const key = `songs/${job.owner_id}/${job.id}.mp3`;
    const audioId = `song-audio-${job.id}`;
    await fixedBody(request, size, (body) =>
      env.AUDIO.put(key, body, { httpMetadata: { contentType: "audio/mpeg" } }),
    );
    await finishOwnedUpload(env, job.owner_id, key);
    await env.DB.prepare(
      "INSERT OR IGNORE INTO audio_objects (id, owner_id, draft_id, object_key, mime_type, size_bytes, duration_ms, kind) VALUES (?, ?, ?, ?, 'audio/mpeg', ?, 0, 'song')",
    )
      .bind(audioId, job.owner_id, job.draft_id, key, size)
      .run();
    return Response.json({
      audioId,
      key,
      mimeType: "audio/mpeg",
      sizeBytes: size,
    });
  }
  const key = `results/${job.owner_id}/${attemptId}${action === "raw" ? ".raw" : ""}.json`;
  await fixedBody(request, size, (body) =>
    env.AUDIO.put(key, body, {
      httpMetadata: { contentType: "application/json" },
    }),
  );
  await finishOwnedUpload(env, job.owner_id, key);
  return Response.json({ key });
}

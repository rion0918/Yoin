import { GoogleProviderError } from "../pipeline/google.ts";
import type { JobRow } from "./database.ts";
import { type Env, HttpError, ReconciliationError } from "./types.ts";

type AttemptRow = {
  status: string;
  output_key: string | null;
  amount_micros: number;
};
type PaidOutput<T> = { value: T; costUsd: number; usage: unknown };
type CachedOutput<T> = PaidOutput<T> & { version: 1 };

export const RESERVATION_USD = { transcribe: 0.6, lyrics: 0.5, music: 0.08 };

async function settle<T>(
  env: Env,
  job: JobRow,
  attemptId: string,
  outputKey: string,
  reserve: number,
  output: PaidOutput<T>,
) {
  const cost = Math.ceil(output.costUsd * 1_000_000);
  if (!Number.isSafeInteger(cost) || cost < 0) throw new ReconciliationError();
  const model =
    output.usage && typeof output.usage === "object" && "model" in output.usage
      ? output.usage.model
      : null;
  const summary = {
    model: typeof model === "string" ? model.slice(0, 200) : null,
    costUsd: output.costUsd,
    resultKey: outputKey,
  };
  await env.DB.prepare(
    "UPDATE provider_attempts SET status = ?, output_key = ?, amount_micros = ?, usage_json = ?, error = NULL WHERE id = ? AND owner_id = ?",
  )
    .bind(
      cost > reserve ? "cost_overrun" : "succeeded",
      outputKey,
      cost,
      JSON.stringify(summary),
      attemptId,
      job.owner_id,
    )
    .run();
  if (cost > reserve)
    throw new HttpError(402, "provider_cost_exceeded_reservation");
  return output.value;
}

export async function paidCall<T>(
  env: Env,
  job: JobRow,
  attemptId: string,
  stage: string,
  reserveUsd: number,
  call: () => Promise<PaidOutput<T>>,
): Promise<T> {
  const reserve = Math.ceil(reserveUsd * 1_000_000);
  const previous = await env.DB.prepare(
    "SELECT status, output_key, amount_micros FROM provider_attempts WHERE id = ? AND owner_id = ?",
  )
    .bind(attemptId, job.owner_id)
    .first<AttemptRow>();
  if (previous?.status === "cost_overrun")
    throw new HttpError(402, "provider_cost_exceeded_reservation");
  if (previous && previous.status !== "failed_before_submission") {
    const outputKey =
      previous.output_key ?? `results/${job.owner_id}/${attemptId}.json`;
    const cached = await env.AUDIO.get(outputKey);
    if (cached) {
      const output = await cached.json<CachedOutput<T>>();
      if (
        output.version !== 1 ||
        !Number.isFinite(output.costUsd) ||
        output.costUsd < 0
      )
        throw new ReconciliationError();
      return await settle(env, job, attemptId, outputKey, reserve, output);
    }
    throw new ReconciliationError();
  }
  const budget = Number(env.AI_BUDGET_USD);
  if (!Number.isFinite(budget) || budget < 0 || budget > 10)
    throw new HttpError(503, "invalid_ai_budget");
  const claimed = await env.DB.prepare(
    "INSERT INTO provider_attempts (id, job_id, owner_id, stage, status, amount_micros, created_at) SELECT ?, ?, ?, ?, 'submitted', ?, ? WHERE (SELECT COALESCE(SUM(amount_micros), 0) FROM provider_attempts WHERE owner_id = ?) + ? <= ? AND NOT EXISTS (SELECT 1 FROM provider_attempts WHERE owner_id = ? AND status = 'cost_overrun') ON CONFLICT(id) DO UPDATE SET job_id = excluded.job_id, status = 'submitted', amount_micros = excluded.amount_micros, created_at = excluded.created_at, runtime_claimed_at = NULL, error = NULL WHERE provider_attempts.owner_id = excluded.owner_id AND provider_attempts.status = 'failed_before_submission' AND provider_attempts.amount_micros = 0",
  )
    .bind(
      attemptId,
      job.id,
      job.owner_id,
      stage,
      reserve,
      new Date().toISOString(),
      job.owner_id,
      reserve,
      Math.floor(budget * 1_000_000),
      job.owner_id,
    )
    .run();
  if (claimed.meta.changes !== 1) {
    const duplicate = await env.DB.prepare(
      "SELECT id FROM provider_attempts WHERE id = ?",
    )
      .bind(attemptId)
      .first();
    if (duplicate) throw new ReconciliationError();
    throw new HttpError(402, "ai_budget_exhausted");
  }
  try {
    const output = await call();
    if (!Number.isFinite(output.costUsd) || output.costUsd < 0)
      throw new ReconciliationError();
    const outputKey = `results/${job.owner_id}/${attemptId}.json`;
    if (!(await env.AUDIO.head(outputKey)))
      await env.AUDIO.put(
        outputKey,
        JSON.stringify({ version: 1, ...output }),
        {
          httpMetadata: { contentType: "application/json" },
        },
      );
    return await settle(env, job, attemptId, outputKey, reserve, output);
  } catch (error) {
    if (
      error instanceof HttpError &&
      error.code === "provider_cost_exceeded_reservation"
    )
      throw error;
    const sent = !(
      error instanceof GoogleProviderError && error.kind === "input"
    );
    await env.DB.prepare(
      "UPDATE provider_attempts SET status = ?, amount_micros = CASE WHEN ? = 0 THEN 0 ELSE amount_micros END, error = ? WHERE id = ? AND owner_id = ?",
    )
      .bind(
        sent ? "needs_reconciliation" : "failed_before_submission",
        sent ? 1 : 0,
        sent ? "provider_outcome_unconfirmed" : "provider_input_rejected",
        attemptId,
        job.owner_id,
      )
      .run();
    if (sent) throw new ReconciliationError();
    throw new HttpError(422, "provider_input_rejected");
  }
}

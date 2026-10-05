import { env, reset } from "cloudflare:test";
import { beforeEach, expect, it } from "vitest";
import { GoogleProviderError } from "../../pipeline/google.ts";
import { type JobRow, ownedJob } from "../database.ts";
import initialSchema from "../migrations/0001_initial.sql?raw";
import runtimeSchema from "../migrations/0002_audio_runtime.sql?raw";
import { applyAccountSchema } from "./schema.ts";

const schema = `${initialSchema}\n${runtimeSchema}`;

import { paidCall } from "../paid.ts";
import { type Env, ReconciliationError } from "../types.ts";

let bindings: Env;
let job: JobRow;

beforeEach(async () => {
  await reset();
  bindings = {
    ...env,
    AI_BUDGET_USD: "10",
  } as unknown as Env;
  await bindings.DB.batch(
    schema
      .split(";")
      .map((statement) => statement.trim())
      .filter(Boolean)
      .map((statement) => bindings.DB.prepare(statement)),
  );
  await applyAccountSchema(bindings.DB);
  await bindings.DB.prepare(
    "INSERT INTO drafts (id, owner_id, title, created_at) VALUES ('draft', 'private-tester', '旅', '2026-10-04')",
  ).run();
  await bindings.DB.prepare(
    "INSERT INTO jobs (id, owner_id, draft_id, kind, idempotency_key, fingerprint, created_at) VALUES ('job', 'private-tester', 'draft', 'generate', 'key', 'hash', '2026-10-04')",
  ).run();
  job = await ownedJob(bindings, "job", "private-tester");
});

it("keeps an ambiguous reservation and never repeats the paid submission", async () => {
  let submissions = 0;
  const call = () =>
    paidCall(bindings, job, "music-job", "music", 0.08, async () => {
      submissions += 1;
      throw new Error(
        "connection interrupted after provider accepted the request",
      );
    });
  await expect(call()).rejects.toBeInstanceOf(ReconciliationError);
  await expect(call()).rejects.toBeInstanceOf(ReconciliationError);
  expect(submissions).toBe(1);
  const row = await bindings.DB.prepare(
    "SELECT status, amount_micros FROM provider_attempts WHERE id = 'music-job'",
  ).first();
  expect(row).toEqual({ status: "needs_reconciliation", amount_micros: 80000 });
});

it("returns a persisted result after a crash before the ledger success update", async () => {
  await bindings.DB.prepare(
    "INSERT INTO provider_attempts (id, job_id, owner_id, stage, status, amount_micros, created_at) VALUES ('music-job', 'job', 'private-tester', 'music', 'submitted', 80000, '2026-10-04')",
  ).run();
  await bindings.AUDIO.put(
    "results/private-tester/music-job.json",
    JSON.stringify({
      version: 1,
      value: { audioId: "saved-song", key: "songs/private-tester/job.mp3" },
      costUsd: 0.06,
      usage: { model: "lyria" },
    }),
  );
  let submissions = 0;
  const output = await paidCall(
    bindings,
    job,
    "music-job",
    "music",
    0.08,
    async () => {
      submissions += 1;
      return {
        value: { audioId: "unexpected", key: "unexpected" },
        costUsd: 0.08,
        usage: {},
      };
    },
  );
  expect(submissions).toBe(0);
  expect(output.audioId).toBe("saved-song");
  expect(
    (
      await bindings.DB.prepare(
        "SELECT amount_micros FROM provider_attempts WHERE id = 'music-job'",
      ).first<{ amount_micros: number }>()
    )?.amount_micros,
  ).toBe(60000);
});

it("recovers an overrun from the result cache before allowing another paid call", async () => {
  await bindings.DB.prepare(
    "INSERT INTO provider_attempts (id, job_id, owner_id, stage, status, amount_micros, created_at) VALUES ('music-job', 'job', 'private-tester', 'music', 'submitted', 80000, '2026-10-04')",
  ).run();
  await bindings.AUDIO.put(
    "results/private-tester/music-job.json",
    JSON.stringify({
      version: 1,
      value: { audioId: "saved-song" },
      costUsd: 0.09,
      usage: { model: "lyria" },
    }),
  );
  let submissions = 0;
  await expect(
    paidCall(bindings, job, "music-job", "music", 0.08, async () => {
      submissions += 1;
      return { value: {}, costUsd: 0.08, usage: {} };
    }),
  ).rejects.toMatchObject({ code: "provider_cost_exceeded_reservation" });
  const attempt = await bindings.DB.prepare(
    "SELECT status, amount_micros FROM provider_attempts WHERE id = 'music-job'",
  ).first();
  expect(attempt).toEqual({ status: "cost_overrun", amount_micros: 90000 });
  await expect(
    paidCall(bindings, job, "another", "music", 0.08, async () => {
      submissions += 1;
      return { value: {}, costUsd: 0.08, usage: {} };
    }),
  ).rejects.toMatchObject({ code: "ai_budget_exhausted" });
  expect(submissions).toBe(0);
});

it("keeps raw music output in R2 and writes only bounded usage metadata to D1", async () => {
  const raw = { audio: { data: "a".repeat(2_000_001) } };
  await paidCall(bindings, job, "music-job", "music", 0.08, async () => ({
    value: { audioId: "saved-song" },
    costUsd: 0.08,
    usage: { model: "lyria", raw },
  }));
  const row = await bindings.DB.prepare(
    "SELECT usage_json FROM provider_attempts WHERE id = 'music-job'",
  ).first<{ usage_json: string }>();
  expect(row?.usage_json.length).toBeLessThan(1000);
  expect(JSON.parse(row?.usage_json ?? "null")).toMatchObject({
    model: "lyria",
    costUsd: 0.08,
    resultKey: "results/private-tester/music-job.json",
  });
  const cached = await bindings.AUDIO.get(
    "results/private-tester/music-job.json",
  );
  expect(await cached?.json()).toMatchObject({
    version: 1,
    usage: { model: "lyria", raw },
    value: { audioId: "saved-song" },
    costUsd: 0.08,
  });
});

it("settles success once and reuses its R2 result", async () => {
  let submissions = 0;
  const call = () =>
    paidCall(bindings, job, "stt-job", "transcribe", 0.6, async () => {
      submissions += 1;
      return {
        value: { text: "あと五分" },
        costUsd: 0.1,
        usage: { tokens: 100 },
      };
    });
  expect(await call()).toEqual({ text: "あと五分" });
  expect(await call()).toEqual({ text: "あと五分" });
  expect(submissions).toBe(1);
  expect(
    (
      await bindings.DB.prepare(
        "SELECT amount_micros FROM provider_attempts WHERE id = 'stt-job'",
      ).first<{ amount_micros: number }>()
    )?.amount_micros,
  ).toBe(100000);
});

it("claims the budget atomically before concurrent calls", async () => {
  bindings.AI_BUDGET_USD = "0.7";
  let submissions = 0;
  const invoke = (attempt: string) =>
    paidCall(bindings, job, attempt, "transcribe", 0.6, async () => {
      submissions += 1;
      return { value: {}, costUsd: 0.6, usage: {} };
    });
  const results = await Promise.allSettled([invoke("a"), invoke("b")]);
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  expect(submissions).toBe(1);
});

it("makes no paid call with the default zero budget", async () => {
  bindings.AI_BUDGET_USD = "0";
  let submissions = 0;
  await expect(
    paidCall(bindings, job, "music-job", "music", 0.08, async () => {
      submissions += 1;
      return { value: {}, costUsd: 0.08, usage: {} };
    }),
  ).rejects.toMatchObject({ code: "ai_budget_exhausted" });
  expect(submissions).toBe(0);
});

it("shares the cumulative budget across different owners", async () => {
  bindings.AI_BUDGET_USD = "0.7";
  await paidCall(bindings, job, "first", "transcribe", 0.6, async () => ({
    value: {},
    costUsd: 0.6,
    usage: {},
  }));
  await bindings.DB.prepare(
    "INSERT INTO drafts (id, owner_id, title, created_at) VALUES ('other-draft', 'other', '旅', '2026-10-05')",
  ).run();
  await bindings.DB.prepare(
    "INSERT INTO jobs (id, owner_id, draft_id, kind, idempotency_key, fingerprint, created_at) VALUES ('other-job', 'other', 'other-draft', 'prepare', 'other-key', 'hash', '2026-10-05')",
  ).run();
  const other = await ownedJob(bindings, "other-job", "other");
  let submissions = 0;
  await expect(
    paidCall(bindings, other, "second", "transcribe", 0.6, async () => {
      submissions++;
      return { value: {}, costUsd: 0.6, usage: {} };
    }),
  ).rejects.toMatchObject({ code: "ai_budget_exhausted" });
  expect(submissions).toBe(0);
});

it("allows an explicit retry only when validation failed before submission", async () => {
  await expect(
    paidCall(bindings, job, "stt-job", "transcribe", 0.6, async () => {
      throw new GoogleProviderError("transcribe", "input");
    }),
  ).rejects.toMatchObject({ code: "provider_input_rejected" });
  expect(
    (
      await bindings.DB.prepare(
        "SELECT amount_micros FROM provider_attempts WHERE id = 'stt-job'",
      ).first<{ amount_micros: number }>()
    )?.amount_micros,
  ).toBe(0);
  let submissions = 0;
  const result = await paidCall(
    bindings,
    job,
    "stt-job",
    "transcribe",
    0.6,
    async () => {
      submissions += 1;
      return {
        value: { text: "旅の会話" },
        costUsd: 0.1,
        usage: { model: "gemini-test" },
      };
    },
  );
  expect(result).toEqual({ text: "旅の会話" });
  expect(submissions).toBe(1);
});

it("retains actual cost if deletion finishes while a provider response is in flight", async () => {
  await expect(
    paidCall(bindings, job, "late-result", "music", 0.08, async () => {
      await bindings.DB.prepare(
        "INSERT INTO accounts (uid, status) VALUES ('private-tester', 'deleted')",
      ).run();
      await bindings.DB.prepare(
        "DELETE FROM provider_attempts WHERE owner_id = 'private-tester'",
      ).run();
      return { value: {}, costUsd: 0.12, usage: {} };
    }),
  ).rejects.toBeDefined();
  expect(
    await bindings.DB.prepare(
      "SELECT status, amount_micros FROM budget_ledger WHERE id = 'late-result'",
    ).first(),
  ).toEqual({ status: "cost_overrun", amount_micros: 120000 });
  expect(
    await bindings.AUDIO.head("results/private-tester/late-result.json"),
  ).toBeNull();
});

it("keeps a known overrun when deletion is pending but its private attempt still exists", async () => {
  await expect(
    paidCall(bindings, job, "deleting-result", "music", 0.08, async () => {
      await bindings.DB.prepare(
        "INSERT INTO accounts (uid, status) VALUES ('private-tester', 'deleting')",
      ).run();
      return { value: {}, costUsd: 0.12, usage: {} };
    }),
  ).rejects.toBeDefined();
  expect(
    await bindings.DB.prepare(
      "SELECT status, amount_micros FROM budget_ledger WHERE id = 'deleting-result'",
    ).first(),
  ).toEqual({ status: "cost_overrun", amount_micros: 120000 });
});

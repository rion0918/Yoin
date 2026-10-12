import { env, reset } from "cloudflare:test";
import { expect, it } from "vitest";
import { audioClip, jobDocument, ownedClip, ownedJob } from "../database.ts";
import initial from "../migrations/0001_initial.sql?raw";
import type { Env } from "../types.ts";
import { applyAccountSchema } from "./schema.ts";

it("migrates existing spend and unknown reservations without resetting the budget", async () => {
  await reset();
  const db = (env as unknown as Env).DB;
  await db.batch(
    initial
      .split(";")
      .map((sql) => sql.trim())
      .filter(Boolean)
      .map((sql) => db.prepare(sql)),
  );
  await db
    .prepare(
      "INSERT INTO drafts (id, owner_id, title, created_at) VALUES ('old-draft', 'private-tester', '旧データ', '2026-10-04')",
    )
    .run();
  await db
    .prepare(
      "INSERT INTO jobs (id, owner_id, draft_id, kind, idempotency_key, fingerprint, created_at) VALUES ('old-job', 'private-tester', 'old-draft', 'generate', 'key', 'hash', '2026-10-04')",
    )
    .run();
  await db
    .prepare(
      "INSERT INTO clips (id, draft_id, owner_id, mime_type, size_bytes, duration_ms, recorded_at, timezone, object_key, status) VALUES ('old-clip', 'old-draft', 'private-tester', 'audio/mp4', 10, 12000, '2026-10-04T01:00:00Z', 'Asia/Tokyo', 'originals/private-tester/old-clip', 'uploaded')",
    )
    .run();
  for (const [id, status, amount] of [
    ["known", "succeeded", 25000],
    ["unknown", "needs_reconciliation", 80000],
  ] as const)
    await db
      .prepare(
        "INSERT INTO provider_attempts (id, job_id, owner_id, stage, status, amount_micros, created_at) VALUES (?, 'old-job', 'private-tester', 'music', ?, ?, '2026-10-04')",
      )
      .bind(id, status, amount)
      .run();
  const original = (
    await db
      .prepare(
        "SELECT id, status, amount_micros FROM provider_attempts ORDER BY id",
      )
      .all()
  ).results;
  await applyAccountSchema(db);
  const ledger = (
    await db.prepare("SELECT * FROM budget_ledger ORDER BY amount_micros").all()
  ).results;
  expect(
    ledger.map(({ status, amount_micros }) => ({ status, amount_micros })),
  ).toEqual(
    original.map(({ status, amount_micros }) => ({ status, amount_micros })),
  );
  expect(
    ledger.every(({ id }) => !original.some((attempt) => attempt.id === id)),
  ).toBe(true);
  expect(new Set(ledger.map(({ id }) => id)).size).toBe(2);
  expect((await db.prepare("SELECT title FROM drafts").first())?.title).toBe(
    "旧データ",
  );
  expect(
    (
      await db
        .prepare("SELECT song_title FROM jobs WHERE id = 'old-job'")
        .first()
    )?.song_title,
  ).toBeNull();
  expect(
    audioClip(
      await ownedClip(env as unknown as Env, "old-clip", "private-tester"),
    ).processing,
  ).toMatchObject({
    status: "unverified",
    clientDurationMs: 12000,
    serverDurationMs: 0,
  });
  expect(
    jobDocument(
      await ownedJob(env as unknown as Env, "old-job", "private-tester"),
    ),
  ).toMatchObject({ expectedChunks: 0, completedChunks: 0 });
  await db.prepare("DELETE FROM provider_attempts").run();
  expect(
    (
      await db
        .prepare("SELECT * FROM budget_ledger ORDER BY amount_micros")
        .all()
    ).results,
  ).toEqual(ledger);
});

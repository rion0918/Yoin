import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { BudgetLedger } from "./budget.ts";

async function ledgerTest(
  run: (ledger: BudgetLedger, path: string) => Promise<void>,
) {
  const directory = await mkdtemp(join(tmpdir(), "yoin-budget-"));
  const path = join(directory, "budget.json");
  try {
    await run(new BudgetLedger(path), path);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
test("durable reservations survive a new process and an unknown outcome is not free", async () => {
  await ledgerTest(async (ledger, path) => {
    await ledger.reserve("unknown-job", "input-a", 9.95);
    const nextProcess = new BudgetLedger(path);
    await assert.rejects(
      nextProcess.reserve("new-job", "input-b", 0.08),
      /予算/,
    );
    const existing = await nextProcess.reserve("unknown-job", "input-a", 9.95);
    assert.equal(existing.costUsd, null);
    assert.equal(existing.reservedUsd, 9.95);
  });
});
test("settling a known result replaces the reservation and reuses it without another charge", async () => {
  await ledgerTest(async (ledger, path) => {
    await ledger.reserve("stt", "input-a", 0.6);
    await ledger.settle("stt", "input-a", 0.015);
    assert.equal((await ledger.reserve("stt", "input-a", 0.6)).costUsd, 0.015);
    await ledger.settle("stt", "input-a", 0.015);
    const json = JSON.parse(await readFile(path, "utf8"));
    assert.equal(Object.keys(json.entries).length, 1);
    await assert.rejects(ledger.reserve("stt", "changed-input", 0.6), /入力/);
  });
});
test("actual cost above its estimate remains charged and stops new calls over $10", async () => {
  await ledgerTest(async (ledger) => {
    await ledger.reserve("stt", "a", 0.6);
    await ledger.settle("stt", "a", 10.1);
    await assert.rejects(ledger.reserve("lyrics", "b", 0.5), /予算/);
    await assert.rejects(ledger.settle("stt", "a", 0.01), /確定/);
  });
});
test("concurrent processes cannot both spend the same remaining budget", async () => {
  await ledgerTest(async (ledger, path) => {
    await ledger.reserve("previous", "p", 9.5);
    const results = await Promise.allSettled([
      ledger.reserve("a", "a", 0.4),
      new BudgetLedger(path).reserve("b", "b", 0.4),
    ]);
    assert.equal(
      results.filter((result) => result.status === "fulfilled").length,
      1,
    );
  });
});

test("handoff deducts known spend and unknown reservations, then blocks new paid stages", async () => {
  await ledgerTest(async (ledger, path) => {
    await ledger.reserve("completed", "a", 0.6);
    await ledger.settle("completed", "a", 0.02);
    await ledger.reserve("unknown", "b", 0.5);
    assert.equal(await ledger.handoff(), 9.48);
    await assert.rejects(
      new BudgetLedger(path).reserve("music", "c", 0.08),
      /引き継/,
    );
    assert.equal((await ledger.reserve("completed", "a", 0.6)).costUsd, 0.02);
    await ledger.settle("unknown", "b", 0.1);
    assert.equal(await new BudgetLedger(path).handoff(), 9.48);
    const json = JSON.parse(await readFile(path, "utf8"));
    assert.equal(json.handedOff, true);
    assert.equal(json.remainingUsd, 9.48);
  });
});

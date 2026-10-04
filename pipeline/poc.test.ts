import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { BudgetLedger } from "./budget.ts";
import { GoogleProviderError } from "./google.ts";
import { inspectAudio, main, runPaidStage } from "./poc.ts";

async function stageTest(
  run: (directory: string, ledger: BudgetLedger) => Promise<void>,
) {
  const directory = await mkdtemp(join(tmpdir(), "yoin-poc-"));
  try {
    await run(directory, new BudgetLedger(join(directory, "budget.json")));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
test("a completed paid stage reuses its durable result without another provider call", async () => {
  await stageTest(async (runDir, ledger) => {
    const previous = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = "test-only";
    try {
      let count = 0;
      const options = {
        runDir,
        ledger,
        stage: "lyrics" as const,
        fingerprint: "a",
        perform: async () => {
          count++;
          return { costUsd: 0.001, blocks: ["original"] };
        },
      };
      assert.deepEqual(await runPaidStage(options), {
        costUsd: 0.001,
        blocks: ["original"],
      });
      delete process.env.GEMINI_API_KEY;
      assert.deepEqual(await runPaidStage(options), {
        costUsd: 0.001,
        blocks: ["original"],
      });
      assert.equal(count, 1);
      await assert.rejects(
        runPaidStage({ ...options, fingerprint: "edited" }),
        /入力/,
      );
      assert.equal(count, 1);
    } finally {
      if (previous === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = previous;
    }
  });
});
test("an ambiguous result retains its reservation and is never blindly retried", async () => {
  await stageTest(async (runDir, ledger) => {
    const previous = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = "test-only";
    try {
      let count = 0;
      const options = {
        runDir,
        ledger,
        stage: "music" as const,
        fingerprint: "a",
        perform: async () => {
          count++;
          throw new GoogleProviderError("music", "unknown");
        },
      };
      await assert.rejects(runPaidStage(options), /unknown/);
      await assert.rejects(runPaidStage(options), /未確定/);
      assert.equal(count, 1);
      const json = JSON.parse(
        await readFile(join(runDir, "budget.json"), "utf8"),
      );
      assert.equal(Object.values(json.entries).length, 1);
      assert.equal(
        (Object.values(json.entries)[0] as { costUsd: number | null }).costUsd,
        null,
      );
    } finally {
      if (previous === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = previous;
    }
  });
});
test("missing credentials never call a provider or reserve money", async () => {
  await stageTest(async (runDir, ledger) => {
    const previous = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    try {
      let count = 0;
      await assert.rejects(
        runPaidStage({
          runDir,
          ledger,
          stage: "music",
          fingerprint: "a",
          perform: async () => {
            count++;
            return { costUsd: 0.08 };
          },
        }),
        /GEMINI_API_KEY/,
      );
      assert.equal(count, 0);
      await assert.rejects(readFile(join(runDir, "budget.json")), {
        code: "ENOENT",
      });
    } finally {
      if (previous !== undefined) process.env.GEMINI_API_KEY = previous;
    }
  });
});
test("ffprobe checks real WAV bytes even with a misleading extension, and rejects text", async () => {
  await stageTest(async (directory) => {
    const samples = 8000;
    const wav = Buffer.alloc(44 + samples * 2);
    wav.write("RIFF", 0);
    wav.writeUInt32LE(wav.length - 8, 4);
    wav.write("WAVEfmt ", 8);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(samples, 24);
    wav.writeUInt32LE(samples * 2, 28);
    wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34);
    wav.write("data", 36);
    wav.writeUInt32LE(samples * 2, 40);
    const path = join(directory, "misleading.mp3");
    await writeFile(path, wav);
    const inspected = await inspectAudio(path);
    assert.equal(inspected.mimeType, "audio/wav");
    assert.equal(inspected.durationMs, 1000);
    await writeFile(path, "not audio");
    await assert.rejects(inspectAudio(path), /ffprobe/);
  });
});
test("CLI rejects ambiguous arguments before calling paid APIs", async () => {
  await assert.rejects(
    main(["prepare", "--audio", "relative.m4a", "--out", ".local/poc/example"]),
    /絶対パス/,
  );
  await assert.rejects(
    main([
      "generate",
      "--run",
      ".local/poc/example",
      "--run",
      ".local/poc/example",
    ]),
    /引数/,
  );
});

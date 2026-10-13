import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { ModuleKind, transpileModule } from "typescript";
import * as contracts from "../../shared/contracts.ts";
import * as location from "../pipeline/location.ts";
import * as account from "./account.ts";
import * as operations from "./operations.ts";

const code = transpileModule(
  readFileSync(new URL("./storage.native.ts", import.meta.url), "utf8"),
  { compilerOptions: { module: ModuleKind.CommonJS } },
).outputText;

function storageHarness(fail = false) {
  const sourceUri = "file://cache/source.wav";
  const files = new Set([sourceUri]);
  const pendingLocations = new Map<
    string,
    { draftId: string; sample: string }
  >();
  const events: string[] = [];
  let failFileDelete = false;
  let failSqlite = false;
  let libraryDocument: string | null = null;
  let start: () => void = () => {};
  const started = new Promise<void>((resolve) => {
    start = resolve;
  });
  let finish: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let operation: Promise<void> = Promise.resolve();
  class Directory {
    uri: string;
    exists = true;
    constructor(...parts: (string | Directory)[]) {
      this.uri = parts
        .map((part) =>
          typeof part === "string"
            ? part.replace(/\/$/, "")
            : part.uri.replace(/\/$/, ""),
        )
        .join("/");
    }
    create() {}
    list() {
      return [...files]
        .filter((uri) => uri.startsWith(`${this.uri.replace(/\/$/, "")}/`))
        .map((uri) => new File(uri));
    }
  }
  class File {
    uri: string;
    extension = ".wav";
    size = 32000;
    type = "audio/wav";
    constructor(base: string | Directory, name?: string) {
      this.uri = typeof base === "string" ? base : `${base.uri}/${name}`;
    }
    get exists() {
      return files.has(this.uri);
    }
    get name() {
      return this.uri.split("/").at(-1) ?? "";
    }
    delete() {
      if (failFileDelete) throw new Error("delete_failed");
      events.push("delete");
      files.delete(this.uri);
    }
    copy(destination: File) {
      return this.relocate(destination, "copy");
    }
    move(destination: File) {
      return this.relocate(destination, "move");
    }
    relocate(destination: File, action: string) {
      events.push(`${action}-start`);
      start();
      operation = gate.then(() => {
        if (fail) throw new Error(`${action}_failed`);
        if (!this.exists) throw new Error("source_deleted");
        files.add(destination.uri);
        if (action === "move") files.delete(this.uri);
        events.push(`${action}-complete`);
      });
      // Observe ignored native promises too, so the RED test has no leaked rejection.
      void operation.catch(() => {});
      return operation;
    }
  }
  const storage = {} as {
    importAudio(uid: string, draftId: string): Promise<contracts.LocalClip>;
    preserveRecording(
      uid: string,
      clip: contracts.SavedRecording,
    ): Promise<contracts.SavedRecording>;
    accountAudioDirectory(uid: string): Directory;
    saveLibrary(uid: string, state: contracts.LibraryDocument): Promise<void>;
    savePendingBackgroundLocationSample(
      uid: string,
      draftId: string,
      clipId: string,
      sample: contracts.LocationSample,
    ): Promise<void>;
    eraseMemory(
      uid: string,
      draftId: string,
      clipIds: string[],
      localUris: string[],
    ): Promise<void>;
  };
  const transaction = {
    async getFirstAsync(sql: string, ...values: unknown[]) {
      if (sql.includes("FROM library"))
        return libraryDocument ? { document: libraryDocument } : null;
      if (sql.includes("FROM pending_location_samples")) {
        const value = pendingLocations.get(String(values[0]));
        return value && value.draftId === values[1]
          ? { sample: value.sample }
          : null;
      }
      return null;
    },
    async runAsync(sql: string, ...values: unknown[]) {
      if (failSqlite) throw new Error("sqlite_failed");
      if (sql.startsWith("INSERT INTO library"))
        libraryDocument = String(values[0]);
      else if (sql.startsWith("INSERT OR IGNORE INTO pending_location_samples"))
        pendingLocations.set(String(values[0]), {
          draftId: String(values[1]),
          sample: String(values[2]),
        });
      else if (sql.startsWith("DELETE FROM pending_location_samples")) {
        for (const [clipId, value] of pendingLocations)
          if (value.draftId === values[0]) pendingLocations.delete(clipId);
      }
    },
  };
  const database = {
    async execAsync() {},
    async withExclusiveTransactionAsync(
      work: (tx: typeof transaction) => Promise<void>,
    ) {
      if (failSqlite) throw new Error("sqlite_failed");
      await work(transaction);
    },
    async getFirstAsync(sql: string) {
      return sql.includes("FROM library") && libraryDocument
        ? { document: libraryDocument }
        : null;
    },
  };
  runInNewContext(code, {
    exports: storage,
    require(name: string) {
      if (name === "expo-audio")
        return { createAudioPlayer: () => ({ release() {} }) };
      if (name === "expo-document-picker")
        return {
          getDocumentAsync: async () => ({
            canceled: false,
            assets: [{ uri: sourceUri, mimeType: "audio/wav" }],
          }),
        };
      if (name === "expo-file-system")
        return {
          File,
          Directory,
          Paths: {
            cache: new Directory("file://cache/"),
            document: new Directory("file://documents/"),
          },
        };
      if (name === "expo-sqlite")
        return { openDatabaseAsync: async () => database };
      if (name === "../../shared/contracts") return contracts;
      if (name === "../pipeline/location") return location;
      if (name === "./account") return account;
      if (name === "./audio.native") return { waitUntilLoaded: async () => 1 };
      if (name === "./operations") return operations;
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  return {
    storage,
    sourceUri,
    files,
    events,
    started,
    finish,
    get operation() {
      return operation;
    },
    pendingLocations,
    setFileDeletionFailure(value: boolean) {
      failFileDelete = value;
    },
    setSqliteFailure(value: boolean) {
      failSqlite = value;
    },
  };
}

for (const action of ["copy", "move"] as const) {
  for (const fail of [false, true]) {
    test(`${action} waits for native completion${fail ? " and propagates failure" : " before returning durable audio"}`, async () => {
      const h = storageHarness(fail);
      const pending =
        action === "copy"
          ? h.storage.importAudio("user", "draft")
          : h.storage.preserveRecording("user", {
              id: "clip",
              draftId: "draft",
              localUri: h.sourceUri,
              durationMs: 1000,
              sizeBytes: 32000,
              mimeType: "audio/wav",
              recordedAt: null,
              importedAt: "2026-10-12T00:00:00Z",
              timezone: "Asia/Tokyo",
              place: null,
            });
      let settled = false;
      void pending.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        },
      );
      await h.started;
      await Promise.resolve();
      await Promise.resolve();
      const before = {
        settled,
        sourceExists: h.files.has(h.sourceUri),
        events: [...h.events],
      };
      h.finish();
      const [result] = await Promise.allSettled([pending, h.operation]);
      assert.equal(before.settled, false);
      assert.equal(before.sourceExists, true);
      assert.deepEqual(before.events, [`${action}-start`]);
      if (fail) {
        assert.equal(result.status, "rejected");
        if (result.status === "rejected")
          assert.equal(result.reason.message, `${action}_failed`);
      } else {
        assert.equal(result.status, "fulfilled");
        if (result.status === "fulfilled")
          assert.ok(h.files.has(result.value.localUri));
        assert.deepEqual(
          h.events,
          action === "copy"
            ? ["copy-start", "copy-complete", "delete"]
            : ["move-start", "move-complete"],
        );
      }
      assert.equal(h.files.has(h.sourceUri), fail && action === "move");
    });
  }
}

test("memory cleanup removes local files and blocks delayed location samples, then retries file failures", async () => {
  const h = storageHarness();
  const directory = h.storage.accountAudioDirectory("user");
  const targetFile = `${directory.uri}/clip.m4a`;
  const otherFile = `${directory.uri}/other.m4a`;
  const recoveryFile = "file://documents/recording-recovery.m4a";
  h.files.add(targetFile);
  h.files.add(otherFile);
  h.files.add(recoveryFile);
  const sample: contracts.LocationSample = {
    latitude: 35,
    longitude: 139,
    accuracy: 5,
    timestamp: 1_800_000_000_000,
  };
  await h.storage.savePendingBackgroundLocationSample(
    "user",
    "target",
    "clip",
    sample,
  );
  await h.storage.saveLibrary("user", {
    ...contracts.emptyLibrary(),
    pendingMemoryDeletions: [
      {
        draftId: "target",
        clipIds: ["clip"],
        localUris: [recoveryFile],
        remote: true,
        status: "deleting",
      },
    ],
  });
  await h.storage.eraseMemory("user", "target", ["clip"], [recoveryFile]);
  await h.storage.savePendingBackgroundLocationSample(
    "user",
    "target",
    "clip",
    sample,
  );
  assert.equal(h.files.has(targetFile), false);
  assert.equal(h.files.has(recoveryFile), false);
  assert.equal(h.files.has(otherFile), true);
  assert.equal(h.pendingLocations.size, 0);

  h.files.add(targetFile);
  h.setFileDeletionFailure(true);
  await assert.rejects(
    h.storage.eraseMemory("user", "target", ["clip"], [recoveryFile]),
    /delete_failed/,
  );
  h.setFileDeletionFailure(false);
  await h.storage.eraseMemory("user", "target", ["clip"], [recoveryFile]);
  assert.equal(h.files.has(targetFile), false);
  assert.equal(h.files.has(otherFile), true);
});

test("memory cleanup preserves audio files when SQLite fails and can be retried", async () => {
  const h = storageHarness();
  const directory = h.storage.accountAudioDirectory("user");
  const targetFile = `${directory.uri}/clip.m4a`;
  h.files.add(targetFile);
  h.setSqliteFailure(true);
  await assert.rejects(
    h.storage.eraseMemory("user", "target", ["clip"], []),
    /sqlite_failed/,
  );
  assert.equal(h.files.has(targetFile), true);
  h.setSqliteFailure(false);
  await h.storage.eraseMemory("user", "target", ["clip"], []);
  assert.equal(h.files.has(targetFile), false);
});

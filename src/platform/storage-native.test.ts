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
  const events: string[] = [];
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
    constructor(...parts: string[]) {
      this.uri = parts.map((part) => part.replace(/\/$/, "")).join("/");
    }
    create() {}
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
    delete() {
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
            cache: { uri: "file://cache/" },
            document: "file://documents/",
          },
        };
      if (name === "expo-sqlite") return {};
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

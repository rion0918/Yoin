import assert from "node:assert/strict";
import test from "node:test";
import type { SongDocument } from "../../shared/contracts.ts";
import {
  createSongExportManager,
  type SongExportDependencies,
  safeMp3FileName,
} from "./songExport.ts";

const song = (overrides: Partial<SongDocument> = {}) =>
  ({
    id: "song-1",
    draftId: "draft-1",
    title: "海辺の思い出",
    audioId: "audio-1",
    ...overrides,
  }) as SongDocument;

function createDependencies(overrides: Partial<SongExportDependencies> = {}) {
  const calls: string[] = [];
  const dependencies: SongExportDependencies = {
    createOperationId: () => "export-1",
    createTemporaryUri: async () => "file:///cache/export-1.mp3",
    getAudioUrl: async (audioId) => {
      calls.push(`url:${audioId}`);
      return { url: "https://audio.example/signed.mp3" };
    },
    download: async (url, uri, options) => {
      calls.push(`download:${url}:${uri}`);
      options.onProgress({ bytesWritten: 4, totalBytes: 8 });
      return { uri, size: 8 };
    },
    saveFile: async ({ sourceUri, fileName, operationId }) => {
      calls.push(`save:${sourceUri}:${fileName}:${operationId}`);
      return {
        status: "saved",
        uri: "content://downloads/song-1",
        fileName,
      };
    },
    cancelSave: async (operationId) => {
      calls.push(`cancel:${operationId}`);
    },
    deleteTemporaryFile: async (uri) => {
      calls.push(`delete-temp:${uri}`);
    },
    deleteSavedFile: async (uri) => {
      calls.push(`delete-saved:${uri}`);
      return true;
    },
    onState: (state) => {
      calls.push(state ? `state:${state.phase}` : "state:idle");
    },
    ...overrides,
  };
  return { calls, dependencies };
}

test("MP3 file names remove Android-invalid characters and use a fallback", () => {
  assert.equal(safeMp3FileName('  海/辺:*?"  '), "海辺.mp3");
  assert.equal(safeMp3FileName("...  "), "Yoinの曲.mp3");
});

test("download completes before the save picker opens and returns its real name", async () => {
  const { calls, dependencies } = createDependencies();
  const manager = createSongExportManager(dependencies);
  const result = await manager.start(song());

  assert.deepEqual(result, {
    status: "saved",
    uri: "content://downloads/song-1",
    fileName: "海辺の思い出.mp3",
  });
  assert.deepEqual(calls.slice(0, 3), [
    "state:downloading",
    "url:audio-1",
    "download:https://audio.example/signed.mp3:file:///cache/export-1.mp3",
  ]);
  assert.ok(
    calls.indexOf("state:saving") >
      calls.indexOf(
        "download:https://audio.example/signed.mp3:file:///cache/export-1.mp3",
      ),
  );
  assert.ok(
    calls.includes("save:file:///cache/export-1.mp3:海辺の思い出.mp3:export-1"),
  );
  assert.ok(calls.includes("delete-temp:file:///cache/export-1.mp3"));
});

test("an empty download fails before opening the save picker and is cleaned up", async () => {
  const { calls, dependencies } = createDependencies({
    download: async (_url, uri) => ({ uri, size: 0 }),
  });
  const result = await createSongExportManager(dependencies).start(song());

  assert.equal(result.status, "failed");
  assert.ok(!calls.some((call) => call.startsWith("save:")));
  assert.ok(calls.includes("delete-temp:file:///cache/export-1.mp3"));
});

test("a retry obtains a fresh audio URL after a download failure", async () => {
  let attempts = 0;
  const { calls, dependencies } = createDependencies({
    getAudioUrl: async () => ({
      url: `https://audio.example/${++attempts}.mp3`,
    }),
    download: async (url, uri) => {
      if (url.endsWith("1.mp3")) throw new Error("network failed");
      return { uri, size: 8 };
    },
  });
  const manager = createSongExportManager(dependencies);

  assert.equal((await manager.start(song())).status, "failed");
  assert.equal((await manager.start(song())).status, "saved");
  assert.equal(attempts, 2);
  assert.ok(calls.some((call) => call.startsWith("save:")));
});

test("only one export can run, and a second request does not open another picker", async () => {
  let finishDownload:
    | ((value: { uri: string; size: number }) => void)
    | undefined;
  const { calls, dependencies } = createDependencies({
    download: () =>
      new Promise((resolve) => {
        finishDownload = resolve;
      }),
  });
  const manager = createSongExportManager(dependencies);
  const first = manager.start(song());
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(await manager.start(song({ id: "song-2" })), {
    status: "busy",
  });
  finishDownload?.({ uri: "file:///cache/export-1.mp3", size: 8 });

  assert.equal((await first).status, "saved");
  assert.equal(calls.filter((call) => call.startsWith("save:")).length, 1);
});

test("cancelling a late URL response prevents download and save", async () => {
  let resolveUrl: ((value: { url: string }) => void) | undefined;
  const { calls, dependencies } = createDependencies({
    getAudioUrl: () =>
      new Promise((resolve) => {
        resolveUrl = resolve;
      }),
  });
  const manager = createSongExportManager(dependencies);
  const pending = manager.start(song());
  manager.cancel();
  resolveUrl?.({ url: "https://audio.example/late.mp3" });

  assert.deepEqual(await pending, { status: "cancelled" });
  assert.ok(!calls.some((call) => call.startsWith("download:")));
  assert.ok(!calls.some((call) => call.startsWith("save:")));
});

test("deleting another memory does not cancel this song, but deleting its own memory does", async () => {
  let resolveUrl: ((value: { url: string }) => void) | undefined;
  const { calls, dependencies } = createDependencies({
    getAudioUrl: () =>
      new Promise((resolve) => {
        resolveUrl = resolve;
      }),
  });
  const manager = createSongExportManager(dependencies);
  const pending = manager.start(song());
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(manager.cancel("draft-elsewhere"), false);
  assert.equal(manager.cancel("draft-1"), true);
  resolveUrl?.({ url: "https://audio.example/late.mp3" });

  assert.deepEqual(await pending, { status: "cancelled" });
  assert.ok(!calls.some((call) => call.startsWith("download:")));
});

test("cancelling while saving suppresses success and removes a late saved file", async () => {
  let finishSave:
    | ((value: { status: "saved"; uri: string; fileName: string }) => void)
    | undefined;
  const { calls, dependencies } = createDependencies({
    saveFile: () =>
      new Promise((resolve) => {
        finishSave = resolve;
      }),
  });
  const manager = createSongExportManager(dependencies);
  const pending = manager.start(song());
  await new Promise((resolve) => setImmediate(resolve));
  manager.cancel();
  finishSave?.({
    status: "saved",
    uri: "content://downloads/partial-song",
    fileName: "海辺の思い出.mp3",
  });

  assert.deepEqual(await pending, { status: "cancelled" });
  assert.ok(calls.includes("cancel:export-1"));
  assert.ok(calls.includes("delete-saved:content://downloads/partial-song"));
});

test("a cancelled save reports when its late file cannot be removed", async () => {
  let finishSave:
    | ((value: { status: "saved"; uri: string; fileName: string }) => void)
    | undefined;
  const { dependencies } = createDependencies({
    saveFile: () =>
      new Promise((resolve) => {
        finishSave = resolve;
      }),
    deleteSavedFile: async () => {
      throw new Error("provider rejected deletion");
    },
  });
  const manager = createSongExportManager(dependencies);
  const pending = manager.start(song());
  await new Promise((resolve) => setImmediate(resolve));
  manager.cancel();
  finishSave?.({
    status: "saved",
    uri: "content://downloads/partial-song",
    fileName: "海辺の思い出.mp3",
  });

  assert.deepEqual(await pending, {
    status: "cancelled",
    cleanupFailed: true,
  });
});

import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  type FileHandle,
  mkdir,
  open,
  readFile,
  realpath,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
  type AudioClip,
  CHUNK_MS,
  MAX_AUDIO_BYTES,
  type Utterance,
} from "../shared/contracts.ts";
import { BUDGET_USD, BudgetLedger, writeDurableJson } from "./budget.ts";
import {
  createLyrics,
  GOOGLE_MODELS,
  GoogleProviderError,
  generateMusic,
  STAGE_RESERVATIONS,
  transcribeAudio,
  validateLyricBlocks,
} from "./google.ts";

const exec = promisify(execFile);
const project = resolve(fileURLToPath(new URL("..", import.meta.url)));
const runRoot = join(project, ".local", "poc");
type Stage = keyof typeof STAGE_RESERVATIONS;
type Inspection = {
  durationMs: number;
  sizeBytes: number;
  mimeType: string;
  extension: string;
};
type Run = {
  version: 1;
  fingerprint: string;
  audioFile: string;
  clip: AudioClip;
};
function hash(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
function code(error: unknown): string | null {
  return error !== null &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : null;
}
async function optionalJson(path: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (code(error) === "ENOENT") return null;
    throw new Error("保存済み JSON を読み取れません。自動で再生成しません。");
  }
}
function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function requireKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key?.trim())
    throw new Error(
      "GEMINI_API_KEY が未設定です。.env.local に設定してください。API は呼び出していません。",
    );
  return key;
}

export async function inspectAudio(path: string): Promise<Inspection> {
  const file = await stat(path);
  if (!file.isFile() || file.size === 0 || file.size > MAX_AUDIO_BYTES)
    throw new Error("音声は空でない100 MiB以下のファイルを指定してください。");
  let output: string;
  try {
    ({ stdout: output } = await exec(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=format_name,duration:stream=codec_type,codec_name",
        "-of",
        "json",
        path,
      ],
      { timeout: 30000, maxBuffer: 1024 * 1024 },
    ));
  } catch {
    throw new Error(
      "ffprobe で音声を確認できません。nix develop 内で有効な音声ファイルを指定してください。",
    );
  }
  const probe = JSON.parse(output) as {
    format?: { duration?: string; format_name?: string };
    streams?: { codec_type?: string; codec_name?: string }[];
  };
  const durationMs = Math.round(Number(probe.format?.duration) * 1000);
  const streams =
    probe.streams?.filter((stream) => stream.codec_type === "audio") ?? [];
  if (
    !Number.isSafeInteger(durationMs) ||
    durationMs <= 0 ||
    durationMs > CHUNK_MS ||
    streams.length !== 1
  )
    throw new Error(
      "PoC は音声トラック1本、長さ25分以下が対象です。最初は3〜5分で検証してください。",
    );
  const formats = new Set(probe.format?.format_name?.split(",") ?? []);
  let encoding: { mimeType: string; extension: string } | null = null;
  if (formats.has("mp3"))
    encoding = { mimeType: "audio/mpeg", extension: "mp3" };
  else if (formats.has("wav"))
    encoding = { mimeType: "audio/wav", extension: "wav" };
  else if (
    (formats.has("mov") || formats.has("mp4")) &&
    streams[0]?.codec_name === "aac"
  )
    encoding = { mimeType: "audio/m4a", extension: "m4a" };
  else if (formats.has("aac"))
    encoding = { mimeType: "audio/aac", extension: "aac" };
  else if (formats.has("flac"))
    encoding = { mimeType: "audio/flac", extension: "flac" };
  else if (formats.has("ogg"))
    encoding = { mimeType: "audio/ogg", extension: "ogg" };
  else if (
    formats.has("webm") &&
    ["opus", "vorbis"].includes(streams[0]?.codec_name ?? "")
  )
    encoding = { mimeType: "audio/webm", extension: "webm" };
  else if (formats.has("aiff"))
    encoding = { mimeType: "audio/aiff", extension: "aiff" };
  if (!encoding)
    throw new Error(
      "実際の音声形式が未対応です。AAC/M4A、WAV、MP3、FLAC、OGG、WebM、AIFF を指定してください。",
    );
  return { durationMs, sizeBytes: file.size, ...encoding };
}

export async function runPaidStage<T extends { costUsd: number }>(options: {
  runDir: string;
  stage: Stage;
  fingerprint: string;
  ledger: BudgetLedger;
  perform: () => Promise<T>;
}): Promise<T> {
  const cachePath = join(options.runDir, `${options.stage}.result.json`);
  const cache = record(await optionalJson(cachePath));
  if (cache && cache.fingerprint !== options.fingerprint)
    throw new Error(
      "保存済み結果の入力が異なります。この run で再課金しません。別の run を明示して検証してください。",
    );
  const result = record(cache?.result);
  if (
    cache &&
    (!result ||
      typeof result.costUsd !== "number" ||
      !Number.isFinite(result.costUsd) ||
      result.costUsd < 0)
  )
    throw new Error("保存済み結果が不正です。自動で再送しません。");
  if (!cache) requireKey();
  const key = hash(`${options.runDir}:${options.stage}`);
  const reservation = await options.ledger.reserve(
    key,
    options.fingerprint,
    STAGE_RESERVATIONS[options.stage],
  );
  if (result) {
    await options.ledger.settle(
      key,
      options.fingerprint,
      result.costUsd as number,
    );
    return result as T;
  }
  if (!reservation.fresh)
    throw new Error(
      "この処理の受付・課金結果は未確定です。予約額を保持して停止します。自動で再送しません。",
    );
  const started = Date.now();
  try {
    const completed = await options.perform();
    await writeDurableJson(cachePath, {
      fingerprint: options.fingerprint,
      result: completed,
    });
    await options.ledger.settle(key, options.fingerprint, completed.costUsd);
    console.log(
      JSON.stringify({
        stage: options.stage,
        elapsedMs: Date.now() - started,
        costUsd: completed.costUsd,
      }),
    );
    return completed;
  } catch (error) {
    if (error instanceof GoogleProviderError)
      await writeDurableJson(
        join(options.runDir, `${options.stage}.error.json`),
        {
          stage: error.stage,
          kind: error.kind,
          status: error.status,
          response: error.response,
        },
      );
    throw error;
  }
}

async function runDirectory(path: string, create: boolean): Promise<string> {
  const directory = resolve(path);
  const within = relative(runRoot, directory);
  if (
    !within ||
    within.startsWith(`..${sep}`) ||
    within === ".." ||
    isAbsolute(within)
  )
    throw new Error(
      "run はプロジェクトの .local/poc/<名前> 配下を指定してください。",
    );
  if (create) await mkdir(directory, { recursive: true, mode: 0o700 });
  const actual = await realpath(directory);
  if (actual !== directory || (await realpath(runRoot)) !== runRoot)
    throw new Error("run 保存先にシンボリックリンクは使えません。");
  return actual;
}
async function withRunLock(
  directory: string,
  action: () => Promise<void>,
): Promise<void> {
  const path = join(directory, ".run.lock");
  let lock: FileHandle;
  try {
    lock = await open(path, "wx", 0o600);
  } catch (error) {
    if (code(error) === "EEXIST")
      throw new Error(
        "この run は使用中です。前のプロセスが終了したことを確認してからロックを手動で解除してください。",
      );
    throw error;
  }
  try {
    await action();
  } finally {
    await lock.close();
    await unlink(path);
  }
}
function recordedAt(value: string | undefined): string | null {
  if (value === undefined) return null;
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    ) ||
    !Number.isFinite(Date.parse(value))
  )
    throw new Error(
      "--recorded-at はタイムゾーン付き ISO 日時を指定してください。例: 2026-10-04T09:00:00+09:00",
    );
  return value;
}
async function prepare(values: Record<string, string>): Promise<void> {
  if (!values.audio || !isAbsolute(values.audio) || !values.out)
    throw new Error(
      "prepare には --audio 絶対パス と --out .local/poc/<名前> が必要です。",
    );
  const inspected = await inspectAudio(values.audio);
  const date = recordedAt(values["recorded-at"]);
  const place = values.place?.trim() || null;
  const bytes = new Uint8Array(await readFile(values.audio));
  if (bytes.byteLength !== inspected.sizeBytes)
    throw new Error(
      "検査後に音声ファイルが変わりました。API は呼び出していません。",
    );
  const fingerprint = hash(
    JSON.stringify({ audioHash: hash(bytes), inspected, date, place }),
  );
  const directory = await runDirectory(values.out, true);
  await withRunLock(directory, async () => {
    const existing = (await optionalJson(
      join(directory, "run.json"),
    )) as Run | null;
    if (existing && existing.fingerprint !== fingerprint)
      throw new Error(
        "この run は別の音声・日時・場所で作成されています。別の --out を指定してください。",
      );
    if (!existing) requireKey();
    const run: Run = existing ?? {
      version: 1,
      fingerprint,
      audioFile: `input.${inspected.extension}`,
      clip: {
        id: randomUUID(),
        draftId: randomUUID(),
        ...inspected,
        recordedAt: date,
        importedAt: new Date().toISOString(),
        timezone: date?.endsWith("Z")
          ? "UTC"
          : date
            ? `UTC${date.slice(-6)}`
            : Intl.DateTimeFormat().resolvedOptions().timeZone,
        place,
      },
    };
    if (!existing) {
      await writeFile(join(directory, run.audioFile), bytes, {
        flag: "wx",
        mode: 0o600,
      });
      await writeDurableJson(join(directory, "run.json"), run);
    }
    const ledger = new BudgetLedger(join(runRoot, "budget.json"));
    const stt = await runPaidStage({
      runDir: directory,
      stage: "transcribe",
      fingerprint: hash(`${fingerprint}:${GOOGLE_MODELS.transcribe}`),
      ledger,
      perform: () =>
        transcribeAudio({
          bytes,
          mimeType: run.clip.mimeType,
          clipId: run.clip.id,
          offsetMs: 0,
          apiKey: requireKey(),
        }),
    });
    if (
      !stt.utterances.every(
        (utterance) =>
          utterance.clipId === run.clip.id &&
          utterance.startMs >= 0 &&
          utterance.endMs <= run.clip.durationMs,
      )
    )
      throw new Error(
        "文字起こしの発話時刻が元音声の範囲外です。補正・再送せず停止しました。",
      );
    await writeDurableJson(join(directory, "transcript.json"), {
      clip: run.clip,
      utterances: stt.utterances,
    });
    const lyrics = await runPaidStage({
      runDir: directory,
      stage: "lyrics",
      fingerprint: hash(
        JSON.stringify({
          model: GOOGLE_MODELS.lyrics,
          utterances: stt.utterances,
        }),
      ),
      ledger,
      perform: () =>
        createLyrics({ utterances: stt.utterances, apiKey: requireKey() }),
    });
    const approved = join(directory, "approved-lyrics.json");
    if ((await optionalJson(approved)) === null)
      await writeDurableJson(approved, { blocks: lyrics.blocks });
    console.log(JSON.stringify({ stage: "waiting_for_lyric_review" }));
  });
}
async function generate(values: Record<string, string>): Promise<void> {
  if (!values.run)
    throw new Error(
      "generate には --run .local/poc/<名前> が必要です。歌詞を確認・修正した後に実行してください。",
    );
  const directory = await runDirectory(values.run, false);
  await withRunLock(directory, async () => {
    const run = (await optionalJson(join(directory, "run.json"))) as Run | null;
    const transcript = record(
      await optionalJson(join(directory, "transcript.json")),
    );
    const prepared = record(
      await optionalJson(join(directory, "lyrics.result.json")),
    );
    if (!run || !Array.isArray(transcript?.utterances) || !prepared?.result)
      throw new Error("prepare 完了後の run を指定してください。");
    const utterances = transcript.utterances as Utterance[];
    if (
      !utterances.every(
        (utterance) =>
          utterance.clipId === run.clip.id &&
          Number.isSafeInteger(utterance.startMs) &&
          Number.isSafeInteger(utterance.endMs) &&
          utterance.startMs >= 0 &&
          utterance.endMs >= utterance.startMs &&
          utterance.endMs <= run.clip.durationMs,
      )
    )
      throw new Error(
        "保存済み発話の時刻・音声IDが元音声と一致しません。生成は行いません。",
      );
    const approved = record(
      await optionalJson(join(directory, "approved-lyrics.json")),
    );
    const blocks = validateLyricBlocks(approved?.blocks, utterances);
    const fingerprint = hash(
      JSON.stringify({ model: GOOGLE_MODELS.music, blocks }),
    );
    const ledger = new BudgetLedger(join(runRoot, "budget.json"));
    const result = await runPaidStage({
      runDir: directory,
      stage: "music",
      fingerprint,
      ledger,
      perform: async () => {
        const music = await generateMusic({ blocks, apiKey: requireKey() });
        return {
          ...music,
          bytes: undefined,
          bytesBase64: Buffer.from(music.bytes).toString("base64"),
        };
      },
    });
    const mp3 = join(directory, "music.mp3");
    await writeFile(mp3, Buffer.from(result.bytesBase64, "base64"), {
      mode: 0o600,
    });
    await writeFile(
      join(directory, "returned-lyrics.txt"),
      result.returnedLyrics,
      { mode: 0o600 },
    );
    await writeDurableJson(join(directory, "approved-lyrics-snapshot.json"), {
      blocks,
    });
    const inspected = await inspectAudio(mp3);
    if (inspected.mimeType !== "audio/mpeg")
      throw new Error(
        "生成音声の実形式が MP3 と一致しません。課金結果は保持しています。",
      );
    await writeDurableJson(join(directory, "song.json"), {
      clips: [run.clip],
      utterances,
      lyrics: { revision: 1, blocks },
      audioFile: "music.mp3",
      durationMs: inspected.durationMs,
      returnedLyricsFile: "returned-lyrics.txt",
      qualityVerified: false,
    });
    console.log(
      JSON.stringify({
        stage: "ready_for_listening",
        durationMs: inspected.durationMs,
      }),
    );
  });
}

export async function main(arguments_: string[]): Promise<void> {
  const command = arguments_[0];
  if (command === "handoff") {
    if (arguments_.length !== 1)
      throw new Error(
        "handoff に追加の引数は不要です。PoC の実行を終了してから引き継いでください。",
      );
    const ledger = new BudgetLedger(join(runRoot, "budget.json"));
    const remainingUsd = await ledger.handoff();
    await writeDurableJson(join(project, ".local", "ai-budget-handoff.json"), {
      limitUsd: BUDGET_USD,
      remainingUsd,
    });
    console.log(JSON.stringify({ remainingUsd }));
    return;
  }
  const allowed =
    command === "prepare"
      ? new Set(["audio", "out", "place", "recorded-at"])
      : new Set(["run"]);
  const values: Record<string, string> = {};
  for (let index = 1; index < arguments_.length; index += 2) {
    const name = arguments_[index]?.slice(2);
    const value = arguments_[index + 1];
    if (
      !arguments_[index]?.startsWith("--") ||
      !name ||
      !allowed.has(name) ||
      !value ||
      value.startsWith("--") ||
      Object.hasOwn(values, name)
    )
      throw new Error(
        "引数が不正です。prepare --audio ABS --out .local/poc/NAME [--place 場所] [--recorded-at ISO日時] / generate --run .local/poc/NAME",
      );
    values[name] = value;
  }
  if (command === "prepare") await prepare(values);
  else if (command === "generate") await generate(values);
  else
    throw new Error(
      "prepare --audio ABS --out .local/poc/NAME [--place 場所] [--recorded-at ISO日時] / generate --run .local/poc/NAME / handoff",
    );
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(
      error instanceof GoogleProviderError
        ? error.message
        : error instanceof Error && !code(error)
          ? error.message
          : "ローカルファイル処理に失敗しました。API の自動再送は行いません。",
    );
    process.exitCode = 1;
  });
}

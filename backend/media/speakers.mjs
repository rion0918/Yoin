import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const MODEL_VERSION =
  "wespeaker-resnet34-lm-e9848563da86f263117134dfd7ad63c92355b37de492b55e325400c9d9c39012";
const MODEL_DIM = 256;
const MIN_AUDIO_MS = 10_000;
const MAX_AUDIO_MS = 30_000;
const MAX_SAMPLE_BYTES = 5 * 1024 * 1024;
const MAX_CHUNK_BYTES = 16 * 1024 * 1024;
const MIN_SPEECH_MS = 2_000;
const MIN_MATCH_INTERVAL_MS = 3_000;
const MATCH_MINIMUM = 0.65;
const MATCH_MARGIN = 0.1;
const modelPath =
  process.env.SPEAKER_MODEL_PATH ||
  join(process.cwd(), "models", "wespeaker_en_voxceleb_resnet34_LM.onnx");
let extractorPromise;

function targetUrl(value, origin, pattern) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("invalid_speaker_audio_url");
  }
  if (
    url.origin !== origin ||
    !pattern.test(url.pathname) ||
    !url.searchParams.has("signature")
  )
    throw new Error("invalid_speaker_audio_url");
  return url;
}

function boundedInteger(value, minimum, maximum) {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

export function chooseSpeaker(embedding, profiles) {
  if (
    !Array.isArray(embedding) ||
    !embedding.length ||
    embedding.some((value) => !Number.isFinite(value))
  )
    return null;
  const norm = Math.hypot(...embedding);
  if (!Number.isFinite(norm) || norm < 1e-8) return null;
  const candidates = profiles
    .flatMap((profile) => {
      if (
        !profile ||
        typeof profile.id !== "string" ||
        !Array.isArray(profile.embedding) ||
        profile.embedding.length !== embedding.length ||
        profile.embedding.some((value) => !Number.isFinite(value))
      )
        return [];
      if (profile.modelVersion && profile.modelVersion !== MODEL_VERSION)
        return [];
      const otherNorm = Math.hypot(...profile.embedding);
      if (!Number.isFinite(otherNorm) || otherNorm < 1e-8) return [];
      const score = embedding.reduce(
        (sum, value, index) =>
          sum + (value / norm) * (profile.embedding[index] / otherNorm),
        0,
      );
      return [{ id: profile.id, score }];
    })
    .sort((a, b) => b.score - a.score);
  const best = candidates[0];
  const runnerUp = candidates[1];
  if (
    !best ||
    best.score < MATCH_MINIMUM ||
    (runnerUp && best.score - runnerUp.score < MATCH_MARGIN)
  )
    return null;
  return best.id;
}

function mergeIntervals(intervals) {
  const result = [];
  for (const [start, end] of intervals.sort(
    (a, b) => a[0] - b[0] || a[1] - b[1],
  )) {
    const last = result.at(-1);
    if (last && start - last[1] <= 250) last[1] = Math.max(last[1], end);
    else result.push([start, end]);
  }
  return result;
}

function subtractIntervals(start, end, excluded) {
  let pieces = [[start, end]];
  for (const [cutStart, cutEnd] of excluded) {
    const next = [];
    for (const [pieceStart, pieceEnd] of pieces) {
      if (cutEnd <= pieceStart || cutStart >= pieceEnd)
        next.push([pieceStart, pieceEnd]);
      else {
        if (cutStart > pieceStart) next.push([pieceStart, cutStart]);
        if (cutEnd < pieceEnd) next.push([cutEnd, pieceEnd]);
      }
    }
    pieces = next;
  }
  return pieces;
}

export function speakerIntervals(utterances, offsetMs, durationMs) {
  const bySpeaker = new Map();
  for (const utterance of utterances) {
    if (!utterance || typeof utterance.speaker !== "string") continue;
    if (!bySpeaker.has(utterance.speaker)) bySpeaker.set(utterance.speaker, []);
    if (
      !Number.isSafeInteger(utterance.startMs) ||
      !Number.isSafeInteger(utterance.endMs) ||
      utterance.endMs <= utterance.startMs
    )
      continue;
  }
  const intervals = new Map(
    [...bySpeaker.keys()].map((speaker) => [speaker, []]),
  );
  for (const utterance of utterances) {
    const start = Math.max(0, utterance.startMs - offsetMs);
    const end = Math.min(durationMs, utterance.endMs - offsetMs);
    if (end <= start) continue;
    const competing = [];
    for (const other of utterances) {
      if (other.speaker === utterance.speaker || other.endMs <= other.startMs)
        continue;
      const otherStart = Math.max(0, other.startMs - offsetMs);
      const otherEnd = Math.min(durationMs, other.endMs - offsetMs);
      if (otherEnd > start && otherStart < end)
        competing.push([otherStart, otherEnd]);
    }
    const pieces = subtractIntervals(start, end, mergeIntervals(competing));
    intervals.get(utterance.speaker).push(...pieces);
  }
  for (const [speaker, values] of intervals) {
    intervals.set(
      speaker,
      mergeIntervals(values).filter(
        ([start, end]) => end - start >= MIN_MATCH_INTERVAL_MS,
      ),
    );
  }
  return intervals;
}

async function readModel() {
  if (!extractorPromise)
    extractorPromise = import("sherpa-onnx-node").then((loaded) => {
      const sherpa =
        loaded.default && !loaded.SpeakerEmbeddingExtractor
          ? loaded.default
          : loaded;
      const extractor = new sherpa.SpeakerEmbeddingExtractor({
        model: modelPath,
        numThreads: 1,
        debug: false,
      });
      if (extractor.dim !== MODEL_DIM)
        throw new Error("speaker_model_dimension_mismatch");
      return { sherpa, extractor };
    });
  return extractorPromise;
}

async function waveData(file, options) {
  const { stdout } = await execFile(
    options.ffprobe,
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration:stream=codec_type",
      "-of",
      "json",
      file,
    ],
    { timeout: 30_000, maxBuffer: 1024 * 1024 },
  );
  const probe = JSON.parse(stdout);
  const durationMs = Math.round(Number(probe.format?.duration) * 1000);
  if (
    !boundedInteger(durationMs, MIN_AUDIO_MS, MAX_AUDIO_MS) ||
    !probe.streams?.some((stream) => stream.codec_type === "audio")
  )
    throw new Error("speaker_sample_too_short");
  const wav = join(options.directory, "normalized.wav");
  await execFile(
    options.ffmpeg,
    [
      "-nostdin",
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      file,
      "-map",
      "0:a:0",
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-c:a",
      "pcm_s16le",
      wav,
    ],
    { timeout: 90_000, maxBuffer: 1024 * 1024 },
  );
  const { sherpa, extractor } = await readModel();
  const wave = sherpa.readWave(wav);
  if (wave.sampleRate !== 16000 || !wave.samples?.length)
    throw new Error("speaker_audio_invalid");
  const samples = wave.samples;
  const frameSamples = 480;
  let activeMs = 0;
  for (let start = 0; start < samples.length; start += frameSamples) {
    const end = Math.min(samples.length, start + frameSamples);
    let energy = 0;
    for (let index = start; index < end; index++)
      energy += samples[index] * samples[index];
    const rms = Math.sqrt(energy / Math.max(1, end - start));
    if (rms >= 0.012) activeMs += Math.round(((end - start) / 16000) * 1000);
  }
  if (activeMs < MIN_SPEECH_MS) throw new Error("speaker_sample_silent");
  const stream = extractor.createStream();
  stream.acceptWaveform({ sampleRate: wave.sampleRate, samples: wave.samples });
  const raw = Array.from(extractor.compute(stream));
  const norm = Math.hypot(...raw);
  if (raw.length !== MODEL_DIM || !Number.isFinite(norm) || norm < 1e-8)
    throw new Error("invalid_speaker_embedding");
  return {
    durationMs,
    speechDurationMs: activeMs,
    embedding: raw.map((value) => value / norm),
  };
}

async function fetchAudio(url, destination, maxBytes, options) {
  const response = await (options.fetch ?? fetch)(url, {
    redirect: "error",
    signal: AbortSignal.timeout(180_000),
  });
  if (!response.ok || !response.body)
    throw new Error("speaker_audio_download_failed");
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error("speaker_audio_too_large");
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (!size) throw new Error("speaker_audio_empty");
  await writeFile(destination, Buffer.concat(chunks));
  return size;
}

export async function enrollSpeaker(body, options) {
  const url = targetUrl(
    body.sourceUrl,
    options.origin,
    /^\/internal\/speakers\/[a-zA-Z0-9_-]+\/samples\/[a-zA-Z0-9_-]+$/,
  );
  const directory = await mkdtemp(join(tmpdir(), "yoin-speaker-enroll-"));
  try {
    const source = join(directory, "sample.audio");
    const sizeBytes = await fetchAudio(url, source, MAX_SAMPLE_BYTES, {
      ...options,
      directory,
    });
    const value = await waveData(source, { ...options, directory });
    return { ...value, sizeBytes, modelVersion: MODEL_VERSION };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function concatIntervals(source, intervals, directory, options) {
  const files = [];
  for (const [index, [start, end]] of intervals.entries()) {
    const file = join(
      directory,
      `segment-${String(index).padStart(3, "0")}.wav`,
    );
    await execFile(
      options.ffmpeg,
      [
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-ss",
        (start / 1000).toFixed(3),
        "-t",
        ((end - start) / 1000).toFixed(3),
        "-i",
        source,
        "-map",
        "0:a:0",
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-c:a",
        "pcm_s16le",
        file,
      ],
      { timeout: 90_000, maxBuffer: 1024 * 1024 },
    );
    files.push(file);
  }
  const manifest = join(directory, "segments.txt");
  await writeFile(manifest, files.map((file) => `file '${file}'`).join("\n"));
  const output = join(directory, "joined.wav");
  await execFile(
    options.ffmpeg,
    [
      "-nostdin",
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      manifest,
      "-ac",
      "1",
      "-ar",
      "16000",
      "-c:a",
      "pcm_s16le",
      output,
    ],
    { timeout: 90_000, maxBuffer: 1024 * 1024 },
  );
  return output;
}

export async function identifySpeakers(body, options) {
  const url = targetUrl(
    body.chunkUrl,
    options.origin,
    /^\/internal\/chunks\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+\/[0-2]$/,
  );
  if (
    !boundedInteger(body.offsetMs, 0, Number.MAX_SAFE_INTEGER) ||
    !boundedInteger(body.durationMs, 1, 25 * 60 * 1000 + 1000) ||
    !Array.isArray(body.utterances) ||
    body.utterances.length > 5000 ||
    !Array.isArray(body.profiles)
  )
    throw new Error("invalid_speaker_request");
  const intervals = speakerIntervals(
    body.utterances,
    body.offsetMs,
    body.durationMs,
  );
  const directory = await mkdtemp(join(tmpdir(), "yoin-speaker-identify-"));
  try {
    const source = join(directory, "chunk.audio");
    await fetchAudio(url, source, MAX_CHUNK_BYTES, { ...options, directory });
    const matches = [];
    for (const [speaker, ranges] of intervals) {
      const speechMs = ranges.reduce(
        (sum, [start, end]) => sum + end - start,
        0,
      );
      let speakerProfileId = null;
      if (speechMs >= MIN_AUDIO_MS && ranges.length) {
        const segmentDirectory = await mkdtemp(join(directory, "segments-"));
        let remaining = MAX_AUDIO_MS;
        const selected = [];
        for (const [start, end] of ranges) {
          if (remaining <= 0) break;
          const take = Math.min(remaining, end - start);
          selected.push([start, start + take]);
          remaining -= take;
        }
        const waveform = await concatIntervals(
          source,
          selected,
          segmentDirectory,
          options,
        );
        const value = await waveData(waveform, {
          ...options,
          directory: segmentDirectory,
        });
        speakerProfileId = chooseSpeaker(value.embedding, body.profiles);
      }
      matches.push({ speaker, speakerProfileId });
    }
    return { matches, modelVersion: MODEL_VERSION };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

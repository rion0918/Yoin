import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { SPEAKER_MATCHING_CONFIG } from "../../shared/speaker-matching.ts";

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
const MIN_MATCH_SPEECH_MS = 1_500;
const MAX_MATCH_AUDIO_MS = 10_000;
const MAX_UNKNOWN_MATCH_UTTERANCES = 60;
const MATCH_MINIMUM = 0.65;
const MATCH_MARGIN = 0.1;
const modelPath =
  process.env.SPEAKER_MODEL_PATH ||
  join(process.cwd(), "models", "wespeaker_en_voxceleb_resnet34_LM.onnx");
let extractorPromise;
let diarizer;
let diarizerKey;

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

export function chooseSpeaker(
  embedding,
  profiles,
  { matchMinimum = MATCH_MINIMUM, matchMargin = MATCH_MARGIN } = {},
) {
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
    best.score < matchMinimum ||
    (runnerUp && best.score - runnerUp.score < matchMargin)
  )
    return null;
  return best.id;
}

function mergeIntervals(intervals, maximumGapMs = 250) {
  const result = [];
  for (const [start, end] of intervals.sort(
    (a, b) => a[0] - b[0] || a[1] - b[1],
  )) {
    const last = result.at(-1);
    if (last && start - last[1] <= maximumGapMs)
      last[1] = Math.max(last[1], end);
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

export function speakerIntervals(
  utterances,
  offsetMs,
  durationMs,
  {
    includeUnknown = false,
    minimumIntervalMs = MIN_MATCH_INTERVAL_MS,
    maximumGapMs = 250,
    excludeUnknownOverlap = false,
  } = {},
) {
  const bySpeaker = new Map();
  for (const utterance of utterances) {
    if (!utterance || typeof utterance.speaker !== "string") continue;
    if (
      !/^spk_[1-8]$/.test(utterance.speaker) &&
      !(includeUnknown && utterance.speaker === "unknown")
    )
      continue;
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
    if (!intervals.has(utterance.speaker)) continue;
    const start = Math.max(0, utterance.startMs - offsetMs);
    const end = Math.min(durationMs, utterance.endMs - offsetMs);
    if (end <= start) continue;
    const competing = [];
    for (const other of utterances) {
      if (
        other.speaker === utterance.speaker ||
        (!intervals.has(other.speaker) && !excludeUnknownOverlap) ||
        other.endMs <= other.startMs
      )
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
      mergeIntervals(values, maximumGapMs).filter(
        ([start, end]) => end - start >= minimumIntervalMs,
      ),
    );
  }
  return intervals;
}

export function speakerUtteranceIntervals(utterances, offsetMs, durationMs) {
  return utterances.flatMap((utterance) => {
    if (
      utterance?.speaker !== "unknown" ||
      typeof utterance.id !== "string" ||
      !utterance.id.length ||
      !Number.isSafeInteger(utterance.startMs) ||
      !Number.isSafeInteger(utterance.endMs) ||
      utterance.endMs <= utterance.startMs
    )
      return [];
    const start = Math.max(0, utterance.startMs - offsetMs);
    const end = Math.min(durationMs, utterance.endMs - offsetMs);
    if (end <= start) return [];
    const competing = utterances.flatMap((other) => {
      if (
        !other ||
        other.id === utterance.id ||
        !Number.isSafeInteger(other.startMs) ||
        !Number.isSafeInteger(other.endMs) ||
        other.endMs <= other.startMs
      )
        return [];
      const otherStart = Math.max(0, other.startMs - offsetMs);
      const otherEnd = Math.min(durationMs, other.endMs - offsetMs);
      return otherEnd > start && otherStart < end
        ? [[otherStart, otherEnd]]
        : [];
    });
    return [
      {
        utteranceId: utterance.id,
        ranges: subtractIntervals(start, end, mergeIntervals(competing)).filter(
          ([rangeStart, rangeEnd]) => rangeEnd - rangeStart > 0,
        ),
      },
    ];
  });
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

async function waveData(
  file,
  options,
  {
    minimumAudioMs = MIN_AUDIO_MS,
    maximumAudioMs = MAX_AUDIO_MS,
    minimumSpeechMs = MIN_SPEECH_MS,
    rmsThreshold = 0.012,
  } = {},
) {
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
    !boundedInteger(durationMs, minimumAudioMs, maximumAudioMs) ||
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
    if (rms >= rmsThreshold)
      activeMs += Math.round(((end - start) / 16000) * 1000);
  }
  if (activeMs < minimumSpeechMs) throw new Error("speaker_sample_silent");
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
  const output = join(directory, "joined.wav");
  const inputs = intervals.map((_, index) => `[part${index}]`).join("");
  const trims = intervals
    .map(
      ([start, end], index) =>
        `[split${index}]atrim=start=${start / 1000}:end=${end / 1000},asetpts=PTS-STARTPTS[part${index}]`,
    )
    .join(";");
  const split = `[0:a]asplit=${intervals.length}${intervals.map((_, index) => `[split${index}]`).join("")}`;
  const filter = `${split};${trims};${inputs}concat=n=${intervals.length}:v=0:a=1[voice]`;
  await execFile(
    options.ffmpeg,
    [
      "-nostdin",
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      source,
      "-filter_complex",
      filter,
      "-map",
      "[voice]",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-c:a",
      "pcm_s16le",
      output,
    ],
    { timeout: 90000, maxBuffer: 1024 * 1024 },
  );
  return output;
}

async function matchVoiceFromIntervals(
  source,
  ranges,
  directory,
  options,
  profiles,
  limits,
) {
  let remaining = limits.maximumAudioMs;
  const selected = [];
  for (const [start, end] of ranges) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, end - start);
    if (take > 0) selected.push([start, start + take]);
    remaining -= take;
  }
  if (limits.maximumAudioMs - remaining < limits.minimumAudioMs) return null;
  const segmentDirectory = await mkdtemp(join(directory, "segments-"));
  try {
    const waveform = await concatIntervals(
      source,
      selected,
      segmentDirectory,
      options,
    );
    const value = await waveData(
      waveform,
      { ...options, directory: segmentDirectory },
      limits,
    );
    return chooseSpeaker(value.embedding, profiles, options.matchingConfig);
  } catch (error) {
    if (
      ["speaker_sample_too_short", "speaker_sample_silent"].includes(
        error.message,
      )
    )
      return null;
    throw error;
  } finally {
    await rm(segmentDirectory, { recursive: true, force: true });
  }
}

export function diarizedSpeakerIntervals(segments, durationMs) {
  const bySpeaker = new Map();
  for (const segment of segments) {
    const start = Math.max(0, Math.round(segment.start * 1000));
    const end = Math.min(durationMs, Math.round(segment.end * 1000));
    if (end <= start) continue;
    const excluded = segments
      .filter((other) => other.speaker !== segment.speaker)
      .map((other) => [
        Math.round(other.start * 1000),
        Math.round(other.end * 1000),
      ]);
    const ranges = subtractIntervals(start, end, excluded);
    if (!bySpeaker.has(segment.speaker)) bySpeaker.set(segment.speaker, []);
    bySpeaker.get(segment.speaker).push(...ranges);
  }
  // Keep gaps out of the voice sample, including short gaps and overlaps.
  for (const [speaker, ranges] of bySpeaker) {
    const merged = [];
    for (const range of ranges.sort((a, b) => a[0] - b[0])) {
      const previous = merged.at(-1);
      if (previous && range[0] <= previous[1])
        previous[1] = Math.max(previous[1], range[1]);
      else merged.push([...range]);
    }
    bySpeaker.set(speaker, merged);
  }
  return bySpeaker;
}
export function utteranceCluster(
  utterance,
  segments,
  offsetMs,
  minimumCoverage,
  utterances = [],
) {
  if (
    utterances.some(
      (other) =>
        other.id !== utterance.id &&
        other.startMs < utterance.endMs &&
        other.endMs > utterance.startMs,
    )
  )
    return null;
  const start = utterance.startMs - offsetMs;
  const end = utterance.endMs - offsetMs;
  if (end <= start) return null;
  const touching = segments.filter(
    (segment) => segment.end * 1000 > start && segment.start * 1000 < end,
  );
  const speakers = new Set(touching.map((segment) => segment.speaker));
  if (speakers.size !== 1) return null;
  const speaker = [...speakers][0];
  const ranges = diarizedSpeakerIntervals(touching, end).get(speaker) ?? [];
  const covered = ranges.reduce(
    (sum, [a, b]) => sum + Math.max(0, Math.min(end, b) - Math.max(start, a)),
    0,
  );
  return covered / (end - start) >= minimumCoverage ? speaker : null;
}
async function diarizeUnknown(source, body, directory, options) {
  const config = body.matchingConfig;
  if (
    config?.version !== 2 ||
    config.method !== "diarization" ||
    config.embeddingModel !== MODEL_VERSION ||
    config.segmentationModel !== SPEAKER_MATCHING_CONFIG.segmentationModel ||
    config.reviewRequired !== true ||
    ![
      config.clusteringThreshold,
      config.matchMinimum,
      config.matchMargin,
      config.minimumCoverage,
      config.windowShiftRatio,
      config.minDurationOn,
      config.minDurationOff,
      config.rmsThreshold,
    ].every(Number.isFinite) ||
    config.clusteringThreshold < 0 ||
    config.clusteringThreshold > 1 ||
    config.matchMinimum < 0 ||
    config.matchMinimum > 1 ||
    config.matchMargin < 0 ||
    config.matchMargin > 1 ||
    config.minimumCoverage < 0.5 ||
    config.minimumCoverage > 1 ||
    config.windowShiftRatio <= 0 ||
    config.windowShiftRatio > 1 ||
    config.minDurationOn <= 0 ||
    config.minDurationOn > 3 ||
    config.minDurationOff < 0 ||
    config.minDurationOff > 5 ||
    config.rmsThreshold <= 0 ||
    config.rmsThreshold >= 1 ||
    !Number.isSafeInteger(config.minimumAudioMs) ||
    config.minimumAudioMs < MIN_MATCH_INTERVAL_MS ||
    !Number.isSafeInteger(config.maximumAudioMs) ||
    config.maximumAudioMs < config.minimumAudioMs ||
    config.maximumAudioMs > MAX_AUDIO_MS ||
    !Number.isSafeInteger(config.minimumSpeechMs) ||
    config.minimumSpeechMs < 1 ||
    config.minimumSpeechMs > config.minimumAudioMs
  )
    throw new Error("invalid_speaker_matching_config");
  const wav = join(directory, "diarization.wav");
  await execFile(
    options.ffmpeg,
    [
      "-nostdin",
      "-loglevel",
      "error",
      "-y",
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
      wav,
    ],
    { timeout: 90000, maxBuffer: 1024 * 1024 },
  );
  const { sherpa } = await readModel();
  const wave = sherpa.readWave(wav);
  if (
    wave.sampleRate !== 16000 ||
    !wave.samples?.length ||
    wave.samples.length > (25 * 60 + 1) * 16000
  )
    throw new Error("speaker_audio_invalid");
  const key = JSON.stringify([
    config.windowShiftRatio,
    config.minDurationOn,
    config.minDurationOff,
  ]);
  if (!diarizer || diarizerKey !== key) {
    diarizer = new sherpa.OfflineSpeakerDiarization({
      segmentation: {
        pyannote: {
          model:
            process.env.SPEAKER_SEGMENTATION_MODEL_PATH ||
            join(
              process.cwd(),
              "models",
              "pyannote-segmentation-3.0.int8.onnx",
            ),
          windowShiftRatio: config.windowShiftRatio,
        },
        numThreads: 1,
      },
      embedding: { model: modelPath, numThreads: 1 },
      clustering: { numClusters: -1, threshold: config.clusteringThreshold },
      minDurationOn: config.minDurationOn,
      minDurationOff: config.minDurationOff,
    });
    diarizerKey = key;
  }
  diarizer.setConfig({
    clustering: { numClusters: -1, threshold: config.clusteringThreshold },
  });
  const segments = diarizer.process(wave.samples);
  if (
    !Array.isArray(segments) ||
    segments.some(
      (segment) =>
        !Number.isFinite(segment.start) ||
        !Number.isFinite(segment.end) ||
        segment.start < 0 ||
        segment.end <= segment.start ||
        !Number.isSafeInteger(segment.speaker) ||
        segment.speaker < 0,
    )
  )
    throw new Error("invalid_speaker_segments");
  const ranges = diarizedSpeakerIntervals(segments, body.durationMs);
  const candidates = new Map();
  for (const [speaker, intervals] of ranges) {
    candidates.set(
      speaker,
      await matchVoiceFromIntervals(
        source,
        intervals,
        directory,
        { ...options, matchingConfig: config },
        body.profiles,
        {
          minimumAudioMs: config.minimumAudioMs,
          maximumAudioMs: config.maximumAudioMs,
          minimumSpeechMs: config.minimumSpeechMs,
          rmsThreshold: config.rmsThreshold,
        },
      ),
    );
  }
  return body.utterances
    .filter((item) => item.speaker === "unknown")
    .map((utterance) => ({
      speaker: "unknown",
      utteranceId: utterance.id,
      speakerProfileId:
        candidates.get(
          utteranceCluster(
            utterance,
            segments,
            body.offsetMs,
            config.minimumCoverage,
            body.utterances,
          ),
        ) ?? null,
    }));
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
    body.matchingConfig
      ? {
          minimumIntervalMs: Math.round(
            body.matchingConfig.minDurationOn * 1000,
          ),
          maximumGapMs: 0,
          excludeUnknownOverlap: true,
        }
      : {},
  );
  const unknownIntervals = speakerUtteranceIntervals(
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
      const speakerProfileId = await matchVoiceFromIntervals(
        source,
        ranges,
        directory,
        { ...options, matchingConfig: body.matchingConfig },
        body.profiles,
        {
          minimumAudioMs: body.matchingConfig?.minimumAudioMs ?? MIN_AUDIO_MS,
          maximumAudioMs: body.matchingConfig?.maximumAudioMs ?? MAX_AUDIO_MS,
          minimumSpeechMs:
            body.matchingConfig?.minimumSpeechMs ?? MIN_SPEECH_MS,
          rmsThreshold: body.matchingConfig?.rmsThreshold ?? 0.012,
        },
      );
      matches.push({ speaker, speakerProfileId });
    }
    if (body.matchingConfig && unknownIntervals.length) {
      matches.push(...(await diarizeUnknown(source, body, directory, options)));
    } else {
      let inferenceCount = 0;
      for (const { utteranceId, ranges } of unknownIntervals) {
        const durationMs = ranges.reduce(
          (sum, [start, end]) => sum + end - start,
          0,
        );
        const speakerProfileId =
          inferenceCount < MAX_UNKNOWN_MATCH_UTTERANCES &&
          durationMs >= MIN_MATCH_INTERVAL_MS
            ? await matchVoiceFromIntervals(
                source,
                ranges,
                directory,
                options,
                body.profiles,
                {
                  minimumAudioMs: MIN_MATCH_INTERVAL_MS,
                  maximumAudioMs: MAX_MATCH_AUDIO_MS,
                  minimumSpeechMs: MIN_MATCH_SPEECH_MS,
                },
              )
            : null;
        if (durationMs >= MIN_MATCH_INTERVAL_MS) inferenceCount++;
        matches.push({ speaker: "unknown", utteranceId, speakerProfileId });
      }
    }
    return {
      matches,
      modelVersion: MODEL_VERSION,
      ...(body.matchingConfig ? { matchingConfig: body.matchingConfig } : {}),
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

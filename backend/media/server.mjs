import { execFile as execFileCallback } from "node:child_process";
import { timingSafeEqual } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { GoogleProviderError } from "../../pipeline/google.ts";
import { runProvider } from "./providers.mjs";

const execFile = promisify(execFileCallback);
const MAX_BYTES = 100 * 1024 * 1024;
const MAX_DURATION_MS = 60 * 60 * 1000;
const CHUNK_SECONDS = 25 * 60;

function authorized(header, token) {
  const supplied = Buffer.from(header ?? "");
  const expected = Buffer.from(`Bearer ${token}`);
  return (
    supplied.length === expected.length && timingSafeEqual(supplied, expected)
  );
}

function mediaUrl(value, origin, upload = false) {
  const url = new URL(value);
  const allowedPath = upload
    ? /^\/internal\/chunks\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+\/\d+$/
    : /^\/media\/[a-zA-Z0-9_-]+$/;
  if (
    url.origin !== origin ||
    !allowedPath.test(url.pathname) ||
    !url.searchParams.has("signature")
  )
    throw new Error("invalid_media_url");
  return url.toString();
}

async function download(url, destination) {
  const response = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(180_000),
  });
  if (!response.ok || !response.body) throw new Error("media_download_failed");
  let bytes = 0;
  const limited = new Transform({
    transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > MAX_BYTES) callback(new Error("audio_too_large"));
      else callback(null, chunk);
    },
  });
  await pipeline(
    Readable.fromWeb(response.body),
    limited,
    createWriteStream(destination),
  );
  if (bytes === 0) throw new Error("empty_audio");
  return bytes;
}

async function probe(file, ffprobe) {
  const { stdout } = await execFile(
    ffprobe,
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration:stream=codec_type",
      "-of",
      "json",
      file,
    ],
    { timeout: 60_000, maxBuffer: 1024 * 1024 },
  );
  const result = JSON.parse(stdout);
  const durationMs = Math.round(Number(result.format?.duration) * 1000);
  if (
    !Number.isSafeInteger(durationMs) ||
    durationMs < 1 ||
    durationMs > MAX_DURATION_MS ||
    !result.streams?.some((stream) => stream.codec_type === "audio")
  )
    throw new Error("invalid_audio");
  return durationMs;
}

async function inspect(body, options, split) {
  const sourceUrl = mediaUrl(body.sourceUrl, options.origin);
  if (
    split &&
    (!Array.isArray(body.uploadUrls) || body.uploadUrls.length !== 3)
  )
    throw new Error("invalid_upload_targets");
  const uploads = split
    ? body.uploadUrls.map((value) => mediaUrl(value, options.origin, true))
    : [];
  const directory = await mkdtemp(join(tmpdir(), "yoin-media-"));
  try {
    const source = join(directory, "source");
    const sizeBytes = await download(sourceUrl, source);
    const durationMs = await probe(source, options.ffprobe);
    if (!split) return { durationMs, sizeBytes, chunks: [] };
    const manifest = join(directory, "chunks.csv");
    await execFile(
      options.ffmpeg,
      [
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
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
        "aac",
        "-b:a",
        "64k",
        "-f",
        "segment",
        "-segment_time",
        String(CHUNK_SECONDS),
        "-reset_timestamps",
        "1",
        "-segment_list",
        manifest,
        "-segment_list_type",
        "csv",
        join(directory, "chunk-%03d.m4a"),
      ],
      { timeout: 600_000, maxBuffer: 1024 * 1024 },
    );
    const rows = (await readFile(manifest, "utf8")).trim().split("\n");
    if (!rows.length || rows.length > 3) throw new Error("invalid_chunk_count");
    const chunks = [];
    for (const [index, row] of rows.entries()) {
      const [filename, start] = row.split(",");
      if (!/^chunk-\d{3}\.m4a$/.test(filename))
        throw new Error("invalid_chunk_name");
      const file = join(directory, filename);
      const size = (await stat(file)).size;
      if (size < 1 || size > 16 * 1024 * 1024)
        throw new Error("invalid_chunk_size");
      const chunkDuration = await probe(file, options.ffprobe);
      const offsetMs = Math.round(Number(start) * 1000);
      if (
        !Number.isSafeInteger(offsetMs) ||
        offsetMs < 0 ||
        chunkDuration > CHUNK_SECONDS * 1000 + 1000
      )
        throw new Error("invalid_chunk_duration");
      const response = await fetch(uploads[index], {
        method: "PUT",
        redirect: "error",
        headers: {
          "Content-Type": "audio/mp4",
          "Content-Length": String(size),
        },
        body: createReadStream(file),
        duplex: "half",
        signal: AbortSignal.timeout(180_000),
      });
      if (!response.ok) throw new Error("media_upload_failed");
      const uploaded = await response.json();
      if (typeof uploaded.key !== "string")
        throw new Error("invalid_upload_result");
      chunks.push({
        key: uploaded.key,
        offsetMs,
        durationMs: chunkDuration,
        mimeType: "audio/mp4",
      });
    }
    return { durationMs, sizeBytes, chunks };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export function createMediaServer({
  token,
  origin,
  ffmpeg = "ffmpeg",
  ffprobe = "ffprobe",
  apiKey,
  providerFetch,
  deleteFirebaseUser = async (uid) => {
    const app =
      getApps()[0] ?? initializeApp({ credential: applicationDefault() });
    await getAuth(app).deleteUser(uid);
  },
}) {
  if (!token || token.length < 32 || !origin)
    throw new Error("media_service_not_configured");
  let busy = false;
  return createServer(async (request, response) => {
    if (request.url === "/health" && request.method === "GET") {
      response.writeHead(200);
      response.end("ok");
      return;
    }
    if (!authorized(request.headers.authorization, token)) {
      response.writeHead(401);
      response.end();
      return;
    }
    if (
      request.method !== "POST" ||
      ![
        "/accounts/delete",
        "/inspect",
        "/probe",
        "/transcribe",
        "/lyrics",
        "/music",
        "/enroll-speaker",
        "/identify-speakers",
      ].includes(request.url)
    ) {
      response.writeHead(404);
      response.end();
      return;
    }
    if (busy) {
      response.writeHead(503, { "Retry-After": "5" });
      response.end();
      return;
    }
    busy = true;
    try {
      const parts = [];
      let size = 0;
      for await (const part of request) {
        size += part.length;
        parts.push(part);
        if (size > 2_000_000) throw new Error("request_too_large");
      }
      const body = JSON.parse(Buffer.concat(parts).toString("utf8"));
      const removeAccount = async () => {
        if (
          typeof body.uid !== "string" ||
          !/^[a-zA-Z0-9_-]{1,128}$/.test(body.uid)
        )
          throw new Error("invalid_account");
        try {
          await deleteFirebaseUser(body.uid);
        } catch (error) {
          if (error?.code !== "auth/user-not-found") throw error;
        }
        return { deleted: true };
      };
      const result =
        request.url === "/accounts/delete"
          ? await removeAccount()
          : request.url === "/enroll-speaker"
            ? await enrollSpeaker(body, { origin, ffmpeg, ffprobe })
            : request.url === "/identify-speakers"
              ? await identifySpeakers(body, { origin, ffmpeg, ffprobe })
              : ["/inspect", "/probe"].includes(request.url)
                ? await inspect(
                    body,
                    { origin, ffmpeg, ffprobe },
                    request.url === "/inspect",
                  )
                : await runProvider(request.url.slice(1), body, {
                    origin,
                    apiKey,
                    providerFetch,
                  });
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(result));
    } catch (error) {
      response.writeHead(422, {
        "Content-Type": "application/json",
        ...(error instanceof GoogleProviderError && error.kind === "input"
          ? { "X-Provider-Input-Rejected": "true" }
          : {}),
      });
      const code =
        error instanceof GoogleProviderError && error.kind === "input"
          ? "provider_input_rejected"
          : typeof error?.message === "string" &&
              /^[a-z_]+$/.test(error.message)
            ? error.message
            : "media_processing_failed";
      response.end(JSON.stringify({ error: code }));
    } finally {
      busy = false;
    }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const server = createMediaServer({
    token: process.env.MEDIA_SERVICE_TOKEN,
    origin: process.env.MEDIA_ORIGIN,
    apiKey: process.env.GEMINI_API_KEY,
    ffmpeg: process.env.FFMPEG_BIN,
    ffprobe: process.env.FFPROBE_BIN,
  });
  server.listen(Number(process.env.PORT ?? 8080), "0.0.0.0");
}

import { enrollSpeaker, identifySpeakers } from "./speakers.mjs";

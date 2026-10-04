import { ownedAudio, ownedClip, ownedJob } from "./database.ts";
import { verifySignedUrl } from "./security.ts";
import { type Env, HttpError } from "./types.ts";
import { integer } from "./validation.ts";

export function byteRange(value: string | null, size: number) {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2]))
    throw new HttpError(416, "invalid_range");
  const offset = match[1]
    ? Number(match[1])
    : Math.max(0, size - Number(match[2]));
  const end =
    match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(end) ||
    offset >= size ||
    end < offset
  )
    throw new HttpError(416, "invalid_range");
  return { offset, length: end - offset + 1 };
}

export async function serveMedia(request: Request, env: Env, audioId: string) {
  await verifySignedUrl(request, env);
  const audio = await ownedAudio(env, audioId, env.OWNER_ID);
  const metadata = await env.AUDIO.head(audio.object_key);
  if (!metadata) throw new HttpError(404, "audio_not_found");
  let range: ReturnType<typeof byteRange>;
  try {
    range = byteRange(request.headers.get("range"), metadata.size);
  } catch {
    return new Response(null, {
      status: 416,
      headers: { "Content-Range": `bytes */${metadata.size}` },
    });
  }
  const object =
    request.method === "HEAD"
      ? null
      : await env.AUDIO.get(audio.object_key, range ? { range } : {});
  if (request.method !== "HEAD" && !object)
    throw new HttpError(404, "audio_not_found");
  const headers = new Headers({
    "Content-Type": audio.mime_type,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store",
    "Content-Length": String(range?.length ?? metadata.size),
    ETag: metadata.httpEtag,
  });
  if (range)
    headers.set(
      "Content-Range",
      `bytes ${range.offset}-${range.offset + range.length - 1}/${metadata.size}`,
    );
  return new Response(object?.body ?? null, {
    status: range ? 206 : 200,
    headers,
  });
}

export async function fixedBody(
  request: Request,
  length: number,
  consume: (body: ReadableStream<Uint8Array>) => Promise<unknown>,
) {
  if (!request.body) throw new HttpError(422, "empty_upload_part");
  const supplied = request.headers.get("content-length");
  if (supplied !== null && Number(supplied) !== length)
    throw new HttpError(422, "invalid_upload_part_size");
  const stream = new FixedLengthStream(length);
  try {
    const [result] = await Promise.all([
      consume(stream.readable),
      request.body.pipeTo(stream.writable),
    ]);
    return result;
  } catch {
    throw new HttpError(422, "upload_part_failed");
  }
}

export function chunkKey(
  owner: string,
  jobId: string,
  clipId: string,
  index: number,
) {
  return `processed/${owner}/${jobId}/${clipId}/${index}.m4a`;
}

export async function serveMediaChunk(
  request: Request,
  env: Env,
  jobId: string,
  clipId: string,
  index: number,
) {
  await verifySignedUrl(request, env);
  const job = await ownedJob(env, jobId, env.OWNER_ID);
  const clip = await ownedClip(env, clipId, env.OWNER_ID);
  if (
    job.kind !== "prepare" ||
    job.draft_id !== clip.draft_id ||
    job.status !== "running" ||
    clip.status !== "uploaded" ||
    index < 0 ||
    index > 2
  )
    throw new HttpError(409, "invalid_media_job");
  const object = await env.AUDIO.get(
    chunkKey(env.OWNER_ID, jobId, clipId, index),
  );
  if (!object) throw new HttpError(404, "media_chunk_missing");
  return new Response(object.body, {
    headers: {
      "Content-Type": "audio/mp4",
      "Content-Length": String(object.size),
      "Cache-Control": "private, no-store",
    },
  });
}

export async function uploadMediaChunk(
  request: Request,
  env: Env,
  jobId: string,
  clipId: string,
  index: number,
) {
  await verifySignedUrl(request, env);
  const job = await ownedJob(env, jobId, env.OWNER_ID);
  const clip = await ownedClip(env, clipId, env.OWNER_ID);
  if (
    job.kind !== "prepare" ||
    job.draft_id !== clip.draft_id ||
    job.status !== "running" ||
    clip.status !== "uploaded" ||
    index < 0 ||
    index > 2
  )
    throw new HttpError(409, "invalid_media_job");
  const size = integer(
    Number(request.headers.get("content-length")),
    1,
    16 * 1024 * 1024,
  );
  const key = chunkKey(env.OWNER_ID, jobId, clipId, index);
  await fixedBody(request, size, (body) =>
    env.AUDIO.put(key, body, { httpMetadata: { contentType: "audio/mp4" } }),
  );
  return Response.json({ key });
}

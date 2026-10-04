import { type Env, HttpError } from "./types.ts";

const encoder = new TextEncoder();
function hex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
}

export async function sha256(value: string) {
  return hex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

function equal(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++)
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

export async function authenticate(request: Request, env: Env) {
  if (!/^[a-f0-9]{64}$/i.test(env.TESTER_TOKEN_SHA256 ?? "") || !env.OWNER_ID)
    throw new HttpError(503, "authentication_not_configured");
  const match = /^Bearer ([^\s]{32,256})$/.exec(
    request.headers.get("authorization") ?? "",
  );
  if (
    !match ||
    !equal(await sha256(match[1]), env.TESTER_TOKEN_SHA256.toLowerCase())
  )
    throw new HttpError(401, "unauthorized");
  return env.OWNER_ID;
}

async function signature(
  secret: string,
  method: string,
  pathname: string,
  expires: string,
) {
  if (!secret || secret.length < 32)
    throw new HttpError(503, "media_signing_not_configured");
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return hex(
    await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(`${method}\n${pathname}\n${expires}`),
    ),
  );
}

export async function signedUrl(
  env: Env,
  pathname: string,
  method = "GET",
  ttlSeconds = 300,
  baseUrl = env.PUBLIC_API_URL,
) {
  const url = new URL(pathname, baseUrl);
  const expires = String(Math.floor(Date.now() / 1000) + ttlSeconds);
  url.searchParams.set("expires", expires);
  url.searchParams.set(
    "signature",
    await signature(env.MEDIA_SIGNING_SECRET, method, pathname, expires),
  );
  return {
    url: url.toString(),
    expiresAt: new Date(Number(expires) * 1000).toISOString(),
  };
}

export async function verifySignedUrl(request: Request, env: Env) {
  const url = new URL(request.url);
  const expires = url.searchParams.get("expires") ?? "";
  const supplied = url.searchParams.get("signature") ?? "";
  const now = Math.floor(Date.now() / 1000);
  if (
    !/^\d+$/.test(expires) ||
    Number(expires) <= now ||
    Number(expires) > now + 3600 ||
    !/^[a-f0-9]{64}$/.test(supplied)
  )
    throw new HttpError(403, "expired_or_invalid_media_url");
  const method = request.method === "HEAD" ? "GET" : request.method;
  if (
    !equal(
      await signature(env.MEDIA_SIGNING_SECRET, method, url.pathname, expires),
      supplied,
    )
  )
    throw new HttpError(403, "expired_or_invalid_media_url");
}

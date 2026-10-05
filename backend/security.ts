import {
  createLocalJWKSet,
  errors,
  type JSONWebKeySet,
  type JWTPayload,
  jwtVerify,
} from "jose";
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

export type Identity = {
  uid: string;
  email: string;
  name: string;
  authTime: number;
};
let keys:
  | {
      expires: number;
      fetchedAt: number;
      resolve: ReturnType<typeof createLocalJWKSet>;
    }
  | undefined;
async function firebaseKeys(refresh = false) {
  if (!refresh && keys && keys.expires > Date.now()) return keys.resolve;
  try {
    const response = await fetch(
      "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com",
      { signal: AbortSignal.timeout(5000) },
    );
    if (!response.ok) throw new Error("key_service_unavailable");
    const resolve = createLocalJWKSet((await response.json()) as JSONWebKeySet);
    const seconds = Number(
      /max-age=(\d+)/.exec(response.headers.get("cache-control") ?? "")?.[1] ??
        0,
    );
    keys = {
      resolve,
      expires: Date.now() + seconds * 1000,
      fetchedAt: Date.now(),
    };
    return resolve;
  } catch {
    throw new HttpError(503, "authentication_unavailable");
  }
}
export async function authenticate(
  request: Request,
  env: Env,
): Promise<Identity> {
  if (!env.FIREBASE_PROJECT_ID || !env.ALLOWED_TESTER_EMAILS)
    throw new HttpError(503, "authentication_not_configured");
  let allowed: unknown;
  try {
    allowed = JSON.parse(env.ALLOWED_TESTER_EMAILS);
  } catch {
    throw new HttpError(503, "authentication_not_configured");
  }
  if (
    !Array.isArray(allowed) ||
    !allowed.every((email) => typeof email === "string")
  )
    throw new HttpError(503, "authentication_not_configured");
  const match = /^Bearer ([^\s]{32,8192})$/.exec(
    request.headers.get("authorization") ?? "",
  );
  if (!match) throw new HttpError(401, "unauthorized");
  const options = {
    algorithms: ["RS256"],
    issuer: `https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`,
    audience: env.FIREBASE_PROJECT_ID,
    requiredClaims: ["sub", "iat", "exp", "auth_time"],
  };
  const resolve = await firebaseKeys();
  let claims: JWTPayload;
  try {
    claims = (await jwtVerify(match[1], resolve, options)).payload;
  } catch (error) {
    if (
      !(error instanceof errors.JWKSNoMatchingKey) ||
      !keys ||
      Date.now() - keys.fetchedAt < 30000
    )
      throw new HttpError(401, "unauthorized");
    const refreshed = await firebaseKeys(true);
    try {
      claims = (await jwtVerify(match[1], refreshed, options)).payload;
    } catch {
      throw new HttpError(401, "unauthorized");
    }
  }
  const now = Math.floor(Date.now() / 1000);
  const provider = claims.firebase as { sign_in_provider?: string } | undefined;
  if (
    !claims.sub ||
    !/^[a-zA-Z0-9_-]{1,128}$/.test(claims.sub) ||
    typeof claims.iat !== "number" ||
    claims.iat > now ||
    typeof claims.auth_time !== "number" ||
    claims.auth_time > now ||
    provider?.sign_in_provider !== "google.com"
  )
    throw new HttpError(401, "unauthorized");
  if (
    claims.email_verified !== true ||
    typeof claims.email !== "string" ||
    !allowed.some(
      (email) => email.toLowerCase() === (claims.email as string).toLowerCase(),
    )
  )
    throw new HttpError(403, "account_not_allowed");
  return {
    uid: claims.sub,
    email: claims.email,
    name: typeof claims.name === "string" ? claims.name : "",
    authTime: claims.auth_time,
  };
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

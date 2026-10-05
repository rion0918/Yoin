import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { vi } from "vitest";

const keys = await generateKeyPair("RS256", { extractable: true });
const jwk = {
  ...(await exportJWK(keys.publicKey)),
  kid: "test-key",
  alg: "RS256",
};
export const projectId = "yoin-auth-test";
export function mockFirebaseKeys() {
  return vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(
      Response.json(
        { keys: [jwk] },
        { headers: { "Cache-Control": "max-age=3600" } },
      ),
    );
}
export async function firebaseToken(
  uid = "private-tester",
  claims: Record<string, unknown> = {},
) {
  return new SignJWT({
    email: "tester@example.com",
    email_verified: true,
    name: "テスター",
    auth_time: Math.floor(Date.now() / 1000),
    firebase: { sign_in_provider: "google.com" },
    ...claims,
  })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(
      typeof claims.iss === "string"
        ? claims.iss
        : `https://securetoken.google.com/${projectId}`,
    )
    .setAudience(typeof claims.aud === "string" ? claims.aud : projectId)
    .setSubject(uid)
    .setIssuedAt(typeof claims.iat === "number" ? claims.iat : undefined)
    .setExpirationTime(typeof claims.exp === "number" ? claims.exp : "1h")
    .sign(keys.privateKey);
}

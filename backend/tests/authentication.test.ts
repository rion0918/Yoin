import { afterEach, expect, it, vi } from "vitest";
import { authenticate } from "../security.ts";
import type { Env } from "../types.ts";
import { firebaseToken, mockFirebaseKeys, projectId } from "./auth-fixture.ts";

afterEach(() => vi.restoreAllMocks());
const bindings = {
  FIREBASE_PROJECT_ID: projectId,
  ALLOWED_TESTER_EMAILS: '["tester@example.com"]',
} as unknown as Env;
const request = (token: string) =>
  new Request("https://yoin.test/account", {
    headers: { Authorization: `Bearer ${token}` },
  });
it("verifies Google Firebase tokens and uses the UID rather than email as owner", async () => {
  mockFirebaseKeys();
  const identity = await authenticate(
    request(await firebaseToken("alice")),
    bindings,
  );
  expect(identity).toMatchObject({ uid: "alice", email: "tester@example.com" });
});
it("rejects unverified emails, other providers, and accounts outside the tester list", async () => {
  mockFirebaseKeys();
  for (const claims of [
    { email_verified: false },
    { email: "outside@example.com" },
    { firebase: { sign_in_provider: "password" } },
  ])
    await expect(
      authenticate(request(await firebaseToken("alice", claims)), bindings),
    ).rejects.toMatchObject({ status: expect.any(Number) });
});
it("rejects tampering and a token for another Firebase project", async () => {
  mockFirebaseKeys();
  const token = await firebaseToken();
  await expect(
    authenticate(request(`${token.slice(0, -8)}AAAAAAAA`), bindings),
  ).rejects.toMatchObject({ status: 401 });
  await expect(
    authenticate(request(token), {
      ...bindings,
      FIREBASE_PROJECT_ID: "other",
    } as Env),
  ).rejects.toMatchObject({ status: 401 });
});

it("refreshes cached signing keys after Firebase rotates them", async () => {
  vi.resetModules();
  const verify = (await import("../security.ts")).authenticate;
  const { exportJWK, generateKeyPair, SignJWT } = await import("jose");
  const fetchKeys = mockFirebaseKeys();
  await verify(request(await firebaseToken("alice")), bindings);
  const pair = await generateKeyPair("RS256", { extractable: true });
  fetchKeys.mockImplementation(async () =>
    Response.json(
      {
        keys: [
          {
            ...(await exportJWK(pair.publicKey)),
            kid: "rotated",
            alg: "RS256",
          },
        ],
      },
      { headers: { "Cache-Control": "max-age=3600" } },
    ),
  );
  const now = Date.now();
  vi.spyOn(Date, "now").mockReturnValue(now + 60000);
  const rotated = await new SignJWT({
    email: "tester@example.com",
    email_verified: true,
    auth_time: Math.floor(now / 1000),
    firebase: { sign_in_provider: "google.com" },
  })
    .setProtectedHeader({ alg: "RS256", kid: "rotated" })
    .setIssuer(`https://securetoken.google.com/${projectId}`)
    .setAudience(projectId)
    .setSubject("alice")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(pair.privateKey);
  expect((await verify(request(rotated), bindings)).uid).toBe("alice");
});

it("rejects expired tokens, future issue/authentication times and wrong issuer or audience", async () => {
  mockFirebaseKeys();
  const now = Math.floor(Date.now() / 1000);
  for (const claims of [
    { exp: now - 60 },
    { iat: now + 60 },
    { auth_time: now + 60 },
    { iss: "https://wrong.test" },
    { aud: "another-project" },
  ])
    await expect(
      authenticate(request(await firebaseToken("alice", claims)), bindings),
    ).rejects.toMatchObject({ status: 401 });
});

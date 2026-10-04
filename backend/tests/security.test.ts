import { expect, it } from "vitest";
import { signedUrl, verifySignedUrl } from "../security.ts";
import type { Env } from "../types.ts";

it("uses a Container-only callback origin while preserving app playback URLs", async () => {
  const bindings = {
    PUBLIC_API_URL: "https://yoin.test",
    MEDIA_SIGNING_SECRET: "test-signing-secret-at-least-thirty-two-bytes",
  } as Env;
  const callback = await signedUrl(
    bindings,
    "/media/clip",
    "GET",
    3600,
    "http://host.docker.internal:8787",
  );
  expect(new URL(callback.url).origin).toBe("http://host.docker.internal:8787");
  await expect(
    verifySignedUrl(new Request(callback.url), bindings),
  ).resolves.toBeUndefined();
  const playback = await signedUrl(bindings, "/media/clip");
  expect(new URL(playback.url).origin).toBe("https://yoin.test");
});

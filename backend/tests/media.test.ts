import { afterEach, expect, it, vi } from "vitest";
import { callMedia } from "../media.ts";
import type { Env } from "../types.ts";

const bindings = {
  MEDIA_SERVICE_URL: "https://audio.yoin.test",
  MEDIA_SERVICE_TOKEN: "t".repeat(64),
} as Env;

afterEach(() => vi.restoreAllMocks());

it("calls the audio runtime with a redirect mode supported by Workers", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const request = input as Request;
    expect(request.redirect).toBe("manual");
    expect(request.headers.get("Authorization")).toBe(
      `Bearer ${bindings.MEDIA_SERVICE_TOKEN}`,
    );
    return Response.json({ durationMs: 1000 });
  });
  expect(await callMedia(bindings, "/probe", {})).toEqual({ durationMs: 1000 });
});

it("forwards the paid provider attempt ID to the audio runtime", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const request = input as Request;
    expect(request.headers.get("X-Provider-Attempt")).toBe("music-job");
    return Response.json({});
  });
  expect(await callMedia(bindings, "/music", {}, "music-job")).toEqual({});
});

it("rejects redirects without forwarding audio runtime credentials", async () => {
  const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(null, {
      status: 302,
      headers: { Location: "https://other.test" },
    }),
  );
  await expect(callMedia(bindings, "/probe", {})).rejects.toMatchObject({
    code: "media_inspection_failed",
  });
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("preserves an explicit pre-provider rejection from the audio runtime", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ error: "media_service_busy" }), {
      status: 503,
      headers: {
        "Content-Type": "application/json",
        "X-Provider-Not-Submitted": "true",
      },
    }),
  );
  await expect(callMedia(bindings, "/music", {})).rejects.toMatchObject({
    kind: "not_submitted",
    status: 503,
    response: "media_service_busy",
  });
});

it("marks missing audio runtime configuration as not submitted", async () => {
  await expect(
    callMedia({ ...bindings, MEDIA_SERVICE_URL: "" }, "/music", {}),
  ).rejects.toMatchObject({
    kind: "not_submitted",
    status: 503,
    response: "media_service_not_configured",
  });
});

import assert from "node:assert/strict";
import test from "node:test";
import type {
  AudioClip,
  LocalLocationRoute,
  LocationSample,
  PendingRecording,
  RecordingLocationRoute,
  Utterance,
} from "../../shared/contracts.ts";
import {
  createLocationRouteRecorder,
  localityName,
  locationRouteRecorderForRecording,
  nearestLocationForUtterance,
  pendingLocationUploads,
  resolveRepresentativePlaces,
  selectRepresentativeLocations,
  shouldSkipLocationSync,
} from "./location.ts";

const origin = Date.parse("2026-10-06T00:00:00.000Z");
const point = (timestamp: number, latitude = 34.66871): LocationSample => ({
  latitude,
  longitude: 135.50131,
  accuracy: 24,
  timestamp,
});

test("place preparation runs while inactive but background retries wait", () => {
  assert.equal(shouldSkipLocationSync(true, "recording", "background"), false);
  assert.equal(shouldSkipLocationSync(false, "recording", "active"), true);
  assert.equal(shouldSkipLocationSync(false, "off", "background"), true);
  assert.equal(shouldSkipLocationSync(false, "off", "active"), false);
});

test("an active conversation can start location capture after recording begins", () => {
  const pending: PendingRecording = {
    purpose: "conversation",
    draftId: "draft-a",
    clipId: "clip-a",
    recordedAt: new Date(origin).toISOString(),
    timezone: "Asia/Tokyo",
    localUri: "file:///clip-a.m4a",
  };
  const recorder = locationRouteRecorderForRecording(null, pending);
  assert.ok(recorder);
  recorder.resume(origin);
  assert.equal(recorder.add(point(origin)), true);
  assert.equal(recorder.finish(origin + 60_000)?.clipId, "clip-a");
  assert.equal(locationRouteRecorderForRecording(recorder, pending), recorder);
  assert.equal(
    locationRouteRecorderForRecording(null, {
      purpose: "speaker",
      speakerProfileId: "speaker-a",
      clipId: "speaker-clip",
      recordedAt: new Date(origin).toISOString(),
      timezone: "Asia/Tokyo",
      localUri: "file:///speaker.m4a",
    }),
    null,
  );
});

function localRoute(index: number, dwellMinutes: number): LocalLocationRoute {
  const base = origin + index * 20 * 60_000;
  const samples = [point(base, 30 + index)];
  for (let minute = 1; minute <= dwellMinutes + 1; minute++)
    samples.push(point(base + minute * 60_000, 30.1 + index));
  samples.push(point(base + (dwellMinutes + 2) * 60_000, 30.2 + index));
  const route: RecordingLocationRoute = {
    version: 1,
    draftId: "draft-a",
    clipId: `clip-${index}`,
    recordedAt: new Date(base).toISOString(),
    endedAt: new Date(samples.at(-1)?.timestamp ?? base).toISOString(),
    segments: [
      { startedAt: base, endedAt: samples.at(-1)?.timestamp ?? base, samples },
    ],
  };
  return {
    route,
    summary: {
      startLocation: samples[0],
      endLocation: samples.at(-1) ?? null,
      representativeLocations: selectRepresentativeLocations(route),
      places: [],
    },
    uploaded: false,
  };
}

test("startup retries wait for preparation and preserve the prepared payload across restarts", async () => {
  const routes = [localRoute(0, 4)];
  for (const sample of routes[0].route.segments[0].samples)
    sample.latitude = 34.66871;
  assert.equal(pendingLocationUploads(routes).length, 0);
  let calls = 0;
  const prepared = await resolveRepresentativePlaces(
    routes,
    [],
    0,
    async () => {
      calls++;
      return "大阪市中央区";
    },
    async () => {},
    origin,
  );
  const restored = JSON.parse(
    JSON.stringify(prepared.routes),
  ) as LocalLocationRoute[];
  assert.deepEqual(pendingLocationUploads(restored, "draft-a"), restored);
  assert.equal(pendingLocationUploads(restored, "other-draft").length, 0);
  const beforeRetry = calls;
  assert.equal(beforeRetry, 1);
  const repeated = await resolveRepresentativePlaces(
    restored,
    [],
    prepared.attempted,
    async () => {
      calls++;
      return "別の市";
    },
    async () => {},
    origin,
  );
  assert.equal(calls, beforeRetry);
  assert.deepEqual(repeated.routes, restored);
  assert.equal(
    pendingLocationUploads(
      restored.map((entry) => ({ ...entry, uploaded: true })),
    ).length,
    0,
  );
});

test("multiple stops in a clip cannot displace its endpoint from the upload summary", () => {
  const entry = localRoute(0, 4);
  const samples = entry.route.segments[0].samples;
  for (let minute = 7; minute <= 10; minute++)
    samples.push(point(origin + minute * 60_000, 30.3));
  const endpoint = point(origin + 11 * 60_000, 30.4);
  samples.push(endpoint);
  entry.route.segments[0].endedAt = endpoint.timestamp;
  entry.route.endedAt = new Date(endpoint.timestamp).toISOString();
  const representatives = selectRepresentativeLocations(entry.route);
  assert.equal(representatives.length, 3);
  assert.deepEqual(representatives.at(-1), endpoint);
  assert.equal(representatives[1].latitude, 30.1);
});

test("failed geocoding still makes the location payload ready for upload and retry", async () => {
  const resolved = await resolveRepresentativePlaces(
    [localRoute(0, 4)],
    [],
    0,
    async () => {
      throw new Error("geocoder unavailable");
    },
    async () => {},
    origin,
  );
  assert.equal(pendingLocationUploads(resolved.routes).length, 1);
  assert.deepEqual(resolved.routes[0].summary.places, []);
});

test("draft geocoding prioritizes chronological endpoints and the longest stop across all clips", async () => {
  const routes = [
    localRoute(0, 3),
    localRoute(1, 4),
    localRoute(2, 8),
    localRoute(3, 3),
  ];
  const queried: LocationSample[] = [];
  const resolved = await resolveRepresentativePlaces(
    [routes[2], routes[0], routes[3], routes[1]],
    [],
    0,
    async (sample) => {
      queried.push(sample);
      return `市${queried.length}`;
    },
    async () => {},
    origin,
  );
  assert.equal(queried.length, 3);
  assert.deepEqual(
    queried.map((sample) => sample.latitude),
    [30, 33.2, 32.1],
  );
  assert.equal(
    resolved.routes.find((entry) => entry.route.clipId === "clip-2")?.summary
      .places[0]?.name,
    "市3",
  );
});

test("automatic locality labels stop at city and ward without duplicating the ward", () => {
  assert.equal(
    localityName({
      city: "大阪市",
      district: "中央区",
    }),
    "大阪市中央区",
  );
  assert.equal(
    localityName({ city: "大阪市中央区", district: "中央区" }),
    "大阪市中央区",
  );
  assert.equal(localityName({ region: "大阪府" }), "大阪府");
});

test("location capture samples at most once a minute and keeps foreground gaps separate", () => {
  const capture = createLocationRouteRecorder(
    "draft-a",
    "clip-a",
    new Date(origin).toISOString(),
  );
  capture.resume(origin);
  assert.equal(capture.add(point(origin)), true);
  assert.equal(capture.add(point(origin + 59_999)), false);
  assert.equal(capture.add(point(origin + 60_000)), true);
  capture.pause(origin + 60_100);
  capture.resume(origin + 600_000);
  assert.equal(capture.add(point(origin + 600_000, 34.7)), true);
  const route = capture.finish(origin + 660_000);
  assert.ok(route);
  assert.equal(route.segments.length, 2);
  assert.deepEqual(
    route.segments.map(({ samples }) => samples.length),
    [2, 1],
  );
  assert.equal(route.endedAt, new Date(origin + 660_000).toISOString());
});

test("location recorder rejects invalid, old, and out-of-order samples", () => {
  const capture = createLocationRouteRecorder(
    "draft-a",
    "clip-a",
    new Date(origin).toISOString(),
  );
  capture.resume(origin);
  assert.equal(capture.add({ ...point(origin), latitude: 100 }), false);
  assert.equal(capture.add({ ...point(origin), accuracy: -1 }), false);
  assert.equal(capture.add(point(origin + 60_000)), true);
  assert.equal(capture.add(point(origin + 30_000)), false);
  assert.equal(capture.finish(origin + 120_000)?.segments[0].samples.length, 1);
});

test("long recordings remain bounded and preserve the first and last samples", () => {
  const capture = createLocationRouteRecorder(
    "draft-a",
    "clip-a",
    new Date(origin).toISOString(),
  );
  capture.resume(origin);
  for (let index = 0; index < 900; index++)
    capture.add(point(origin + index * 60_000));
  const route = capture.finish(origin + 900 * 60_000);
  assert.ok(route);
  assert.ok(
    route.segments.reduce((sum, segment) => sum + segment.samples.length, 0) <=
      512,
  );
  assert.equal(route.segments[0].samples[0].timestamp, origin);
  const lastSegment = route.segments.at(-1);
  assert.equal(lastSegment?.samples.at(-1)?.timestamp, origin + 899 * 60_000);
});

test("utterances use only a nearby point from the same foreground segment", () => {
  const route: RecordingLocationRoute = {
    version: 1,
    draftId: "draft-a",
    clipId: "clip-a",
    recordedAt: new Date(origin).toISOString(),
    endedAt: new Date(origin + 900_000).toISOString(),
    segments: [
      {
        startedAt: origin,
        endedAt: origin + 60_000,
        samples: [point(origin), point(origin + 60_000)],
      },
      {
        startedAt: origin + 600_000,
        endedAt: origin + 660_000,
        samples: [point(origin + 600_000, 34.7)],
      },
    ],
  };
  const clip = {
    id: "clip-a",
    draftId: "draft-a",
    recordedAt: new Date(origin).toISOString(),
    durationMs: 900_000,
  } as AudioClip;
  const utterance: Utterance = {
    id: "u1",
    clipId: "clip-a",
    startMs: 8_000,
    endMs: 10_000,
    speaker: "A",
    text: "こんにちは",
  };
  assert.equal(
    nearestLocationForUtterance(clip, utterance, route)?.timestamp,
    origin,
  );
  assert.equal(
    nearestLocationForUtterance(
      clip,
      { ...utterance, startMs: 300_000, endMs: 301_000 },
      route,
    ),
    null,
  );
  assert.equal(
    nearestLocationForUtterance(
      clip,
      { ...utterance, startMs: 900_000, endMs: 901_000 },
      route,
    ),
    null,
  );
});

test("representative points include route endpoints and the longest sustained stop", () => {
  const capture = createLocationRouteRecorder(
    "draft-a",
    "clip-a",
    new Date(origin).toISOString(),
  );
  capture.resume(origin);
  capture.add(point(origin, 34.5));
  for (let minute = 1; minute <= 4; minute++)
    capture.add(point(origin + minute * 60_000, 34.6));
  capture.add(point(origin + 5 * 60_000, 34.7));
  const route = capture.finish(origin + 6 * 60_000);
  assert.ok(route);
  const representatives = selectRepresentativeLocations(route);
  assert.ok(representatives.length <= 3);
  assert.equal(representatives[0].timestamp, origin);
  assert.equal(representatives.at(-1)?.timestamp, origin + 5 * 60_000);
  assert.ok(representatives.some((sample) => sample.latitude === 34.6));
});

test("place resolution is capped at three per draft and reuses nearby cached results", async () => {
  const routes = Array.from({ length: 5 }, (_, index) => {
    const base = origin + index * 10 * 60_000;
    const samples = [0, 1, 2, 3, 4].map((minute) =>
      point(base + minute * 60_000, 34 + index),
    );
    const route: RecordingLocationRoute = {
      version: 1,
      draftId: "draft-a",
      clipId: `clip-${index}`,
      recordedAt: new Date(base).toISOString(),
      endedAt: new Date(base + 5 * 60_000).toISOString(),
      segments: [
        {
          startedAt: base,
          endedAt: base + 4 * 60_000,
          samples,
        },
      ],
    };
    return {
      route,
      summary: {
        startLocation: samples[0],
        endLocation: samples.at(-1) ?? null,
        representativeLocations: [
          samples[0],
          samples[2],
          samples.at(-1) ?? samples[0],
        ],
        places: [],
      },
      uploaded: false,
    };
  });
  let calls = 0;
  let reserved = 0;
  const reverse = async () => {
    assert.equal(reserved, calls + 1);
    calls++;
    return `市${calls}`;
  };
  const saveAttempt = async (value: number) => {
    reserved = value;
  };
  const first = await resolveRepresentativePlaces(
    routes,
    [],
    0,
    reverse,
    saveAttempt,
    origin,
  );
  assert.equal(calls, 2);
  assert.equal(reserved, 2);
  assert.equal(first.attempted, 2);
  assert.ok(first.cache.length <= 3);

  const repeated = await resolveRepresentativePlaces(
    routes,
    first.cache,
    first.attempted,
    reverse,
    saveAttempt,
    origin,
  );
  assert.equal(calls, 2);
  assert.ok(repeated.routes.some((entry) => entry.summary.places.length > 0));
});

test("nearby candidates share a failed geocoding attempt", async () => {
  const routes: LocalLocationRoute[] = [0, 1].map((index) => {
    const startedAt = origin + index * 10 * 60_000;
    const samples = [0, 1, 2, 3, 4].map((minute) =>
      point(startedAt + minute * 60_000),
    );
    const route: RecordingLocationRoute = {
      version: 1,
      draftId: "draft-a",
      clipId: `nearby-${index}`,
      recordedAt: new Date(startedAt).toISOString(),
      endedAt: new Date(startedAt + 5 * 60_000).toISOString(),
      segments: [
        {
          startedAt,
          endedAt: startedAt + 4 * 60_000,
          samples,
        },
      ],
    };
    return {
      route,
      summary: {
        startLocation: samples[0],
        endLocation: samples.at(-1) ?? null,
        representativeLocations: [
          samples[0],
          samples[2],
          samples.at(-1) ?? samples[0],
        ],
        places: [],
      },
      uploaded: false,
    };
  });
  let calls = 0;
  const resolved = await resolveRepresentativePlaces(
    routes,
    [],
    0,
    async () => {
      calls++;
      return null;
    },
    async () => {},
    origin,
  );
  assert.equal(calls, 1);
  assert.equal(resolved.attempted, 1);
});

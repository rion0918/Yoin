import type {
  AudioClip,
  LocalLocationPlaceCache,
  LocalLocationRoute,
  LocationSample,
  LocationSegment,
  PendingRecording,
  RecordingLocationRoute,
  Utterance,
} from "../../shared/contracts.ts";

export const LOCATION_SAMPLE_INTERVAL_MS = 60_000;
export const MAX_LOCATION_SAMPLES = 512;
export const MAX_UTTERANCE_LOCATION_DELTA_MS = 120_000;
const DWELL_RADIUS_METERS = 200;
const MIN_DWELL_MS = 3 * 60_000;
const MAX_LOCATION_PLACE_CACHE = 128;
const LOCATION_PLACE_CACHE_MS = 30 * 24 * 60 * 60_000;

function validSample(sample: LocationSample) {
  return (
    Number.isFinite(sample.latitude) &&
    sample.latitude >= -90 &&
    sample.latitude <= 90 &&
    Number.isFinite(sample.longitude) &&
    sample.longitude >= -180 &&
    sample.longitude <= 180 &&
    Number.isFinite(sample.accuracy) &&
    sample.accuracy >= 0 &&
    Number.isSafeInteger(sample.timestamp) &&
    sample.timestamp >= 0
  );
}

function sampleCount(segments: LocationSegment[]) {
  return segments.reduce((sum, segment) => sum + segment.samples.length, 0);
}

function compactSegments(segments: LocationSegment[]) {
  let stride = 2;
  while (
    segments.length > MAX_LOCATION_SAMPLES ||
    sampleCount(segments) > MAX_LOCATION_SAMPLES
  ) {
    const lastSegment = segments.length - 1;
    segments = segments.filter(
      (_segment, index) =>
        index === 0 || index === lastSegment || index % stride === 0,
    );
    segments = segments.map((segment) => {
      const lastSample = segment.samples.length - 1;
      return {
        ...segment,
        samples: segment.samples.filter(
          (_sample, index) =>
            index === 0 || index === lastSample || index % stride === 0,
        ),
      };
    });
    stride *= 2;
  }
  return segments;
}

export function createLocationRouteRecorder(
  draftId: string,
  clipId: string,
  recordedAt: string,
) {
  let segments: LocationSegment[] = [];
  let current: LocationSegment | null = null;
  let lastTimestamp = Number.NEGATIVE_INFINITY;

  function pause(timestamp: number) {
    if (!current) return;
    current.endedAt = Math.max(current.startedAt, current.endedAt, timestamp);
    segments = [...segments, current];
    current = null;
  }

  return {
    resume(timestamp: number) {
      if (!current && Number.isSafeInteger(timestamp) && timestamp >= 0)
        current = { startedAt: timestamp, endedAt: timestamp, samples: [] };
    },
    pause,
    add(sample: LocationSample) {
      if (
        !current ||
        !validSample(sample) ||
        sample.timestamp < current.startedAt ||
        sample.timestamp <= lastTimestamp ||
        sample.timestamp - lastTimestamp < LOCATION_SAMPLE_INTERVAL_MS
      )
        return false;
      current.samples.push({ ...sample });
      current.endedAt = sample.timestamp;
      lastTimestamp = sample.timestamp;
      const nextSegments = [...segments, current];
      if (sampleCount(nextSegments) > MAX_LOCATION_SAMPLES) {
        const compacted = compactSegments(nextSegments);
        current = compacted.at(-1) ?? current;
        segments = compacted.slice(0, -1);
      }
      return true;
    },
    finish(timestamp: number): RecordingLocationRoute | null {
      pause(timestamp);
      const completed = segments.filter((segment) => segment.samples.length);
      segments = [];
      if (!completed.length) return null;
      const endedAt = completed.reduce(
        (latest, segment) => Math.max(latest, segment.endedAt),
        timestamp,
      );
      return {
        version: 1,
        draftId,
        clipId,
        recordedAt,
        endedAt: new Date(endedAt).toISOString(),
        segments: completed,
      };
    },
  };
}

export function locationRouteRecorderForRecording(
  existing: ReturnType<typeof createLocationRouteRecorder> | null,
  pending: PendingRecording | null,
) {
  if (existing || !pending || pending.purpose === "speaker") return existing;
  return createLocationRouteRecorder(
    pending.draftId,
    pending.clipId,
    pending.recordedAt,
  );
}

function flatten(route: RecordingLocationRoute) {
  return route.segments.flatMap((segment) =>
    segment.samples.map((sample) => ({ sample, segment })),
  );
}

function distanceMeters(left: LocationSample, right: LocationSample) {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitudeDelta = radians(right.latitude - left.latitude);
  const longitudeDelta = radians(right.longitude - left.longitude);
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(radians(left.latitude)) *
      Math.cos(radians(right.latitude)) *
      Math.sin(longitudeDelta / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function createLocalLocationSummary(route: RecordingLocationRoute) {
  const samples = flatten(route).map(({ sample }) => sample);
  const representatives = selectRepresentativeLocations(route);
  return {
    startLocation: samples[0] ?? null,
    endLocation: samples.at(-1) ?? null,
    representativeLocations: representatives,
    places: [] as { name: string; timestamp: number }[],
  };
}

export function localityName(
  address:
    | {
        city?: string | null;
        district?: string | null;
        region?: string | null;
        subregion?: string | null;
      }
    | null
    | undefined,
): string | null {
  if (!address) return null;
  const city = address.city?.trim() || address.region?.trim() || "";
  const ward = [address.district, address.subregion]
    .map((part) => part?.trim() ?? "")
    .find((part) => part.endsWith("区"));
  const values = [city, ward && !city.endsWith(ward) ? ward : ""].filter(
    Boolean,
  );
  return values.length ? values.join("") : null;
}

function dwellLocations(route: RecordingLocationRoute) {
  const stops: { sample: LocationSample; duration: number }[] = [];

  for (const segment of route.segments) {
    let start = 0;
    while (start < segment.samples.length) {
      let end = start;
      while (
        end + 1 < segment.samples.length &&
        distanceMeters(segment.samples[start], segment.samples[end + 1]) <=
          DWELL_RADIUS_METERS
      )
        end++;
      const duration =
        segment.samples[end].timestamp - segment.samples[start].timestamp;
      if (duration >= MIN_DWELL_MS)
        stops.push({
          sample: segment.samples[Math.floor((start + end) / 2)],
          duration,
        });
      start = end + 1;
    }
  }
  stops.sort((left, right) => right.duration - left.duration);
  return stops;
}

export function selectRepresentativeLocations(
  route: RecordingLocationRoute,
): LocationSample[] {
  const samples = flatten(route);
  if (!samples.length) return [];
  const first = samples[0].sample;
  const last = samples.at(-1)?.sample ?? first;
  const longestStop = dwellLocations(route)[0]?.sample;
  return [first, ...(longestStop ? [longestStop] : []), last].filter(
    (sample, index, candidates) =>
      candidates.findIndex((value) => value.timestamp === sample.timestamp) ===
      index,
  );
}

export function nearestLocationForUtterance(
  clip: Pick<AudioClip, "recordedAt" | "durationMs">,
  utterance: Utterance,
  route: RecordingLocationRoute,
): LocationSample | null {
  if (
    !clip.recordedAt ||
    !Number.isFinite(Date.parse(clip.recordedAt)) ||
    utterance.startMs < 0 ||
    utterance.startMs > clip.durationMs
  )
    return null;
  const target = Date.parse(clip.recordedAt) + utterance.startMs;
  const segment = route.segments.find(
    (value) => target >= value.startedAt && target <= value.endedAt,
  );
  if (!segment) return null;
  let nearest: LocationSample | null = null;
  let delta = Number.POSITIVE_INFINITY;
  for (const sample of segment.samples) {
    const distance = Math.abs(sample.timestamp - target);
    if (distance < delta) {
      nearest = sample;
      delta = distance;
    }
  }
  return delta <= MAX_UTTERANCE_LOCATION_DELTA_MS ? nearest : null;
}

export function pendingLocationUploads(
  routes: LocalLocationRoute[],
  draftId?: string,
) {
  return routes.filter(
    (entry) =>
      entry.preparedForUpload &&
      !entry.uploaded &&
      (!draftId || entry.route.draftId === draftId),
  );
}

export async function resolveRepresentativePlaces(
  routes: LocalLocationRoute[],
  cache: LocalLocationPlaceCache[],
  attempted: number,
  reverseGeocode: (sample: LocationSample) => Promise<string | null>,
  reserveAttempt: (attempted: number) => Promise<void> = async () => {},
  now = Date.now(),
) {
  if (routes.every((entry) => entry.preparedForUpload || entry.uploaded))
    return { routes, cache, attempted };
  const samples = routes
    .flatMap((entry) =>
      flatten(entry.route).map(({ sample }) => ({
        clipId: entry.route.clipId,
        sample,
      })),
    )
    .sort((left, right) => left.sample.timestamp - right.sample.timestamp);
  const longestStop = routes
    .flatMap((entry) =>
      dwellLocations(entry.route).map((stop) => ({
        ...stop,
        clipId: entry.route.clipId,
      })),
    )
    .sort((left, right) => right.duration - left.duration)[0];
  const candidates = [
    ...samples.slice(0, 1),
    ...samples.slice(-1),
    ...(longestStop ? [longestStop] : []),
  ].filter(
    (candidate, index, values) =>
      values.findIndex(
        (value) =>
          value.clipId === candidate.clipId &&
          value.sample.timestamp === candidate.sample.timestamp,
      ) === index,
  );
  const resolved = new Map<
    string,
    { name: string; timestamp: number; sample: LocationSample }[]
  >();
  const seenAreas: { sample: LocationSample; name?: string }[] = [];
  let nextCache = cache.filter(
    (place) => now - place.cachedAt <= LOCATION_PLACE_CACHE_MS,
  );
  let attempts = Math.max(0, Math.min(3, attempted));

  for (const { clipId, sample } of candidates) {
    const cached = nextCache.find(
      (place) => distanceMeters(place, sample) <= 250,
    );
    const nearby = seenAreas.find(
      (place) => distanceMeters(place.sample, sample) <= 250,
    );
    let name = cached?.name ?? nearby?.name;
    if (!cached && !nearby && attempts < 3) {
      attempts++;
      await reserveAttempt(attempts);
      try {
        name = (await reverseGeocode(sample))?.trim() || undefined;
      } catch {
        name = undefined;
      }
      if (name) {
        nextCache = [...nextCache, { ...sample, name, cachedAt: now }]
          .sort((left, right) => right.cachedAt - left.cachedAt)
          .slice(0, MAX_LOCATION_PLACE_CACHE);
      }
    }
    if (!cached && !nearby) seenAreas.push({ sample, name });
    if (!name) continue;
    const places = resolved.get(clipId) ?? [];
    if (!places.some((place) => distanceMeters(place.sample, sample) <= 250))
      resolved.set(clipId, [
        ...places,
        { name, timestamp: sample.timestamp, sample },
      ]);
  }
  return {
    routes: routes.map((entry) =>
      entry.preparedForUpload || entry.uploaded
        ? entry
        : {
            ...entry,
            preparedForUpload: true,
            summary: {
              ...entry.summary,
              representativeLocations: selectRepresentativeLocations(
                entry.route,
              ),
              places:
                resolved
                  .get(entry.route.clipId)
                  ?.map(({ name, timestamp }) => ({ name, timestamp })) ??
                entry.summary.places,
            },
          },
    ),
    cache: nextCache,
    attempted: attempts,
  };
}

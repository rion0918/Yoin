import * as Location from "expo-location";
import { openDatabaseAsync } from "expo-sqlite";
import * as TaskManager from "expo-task-manager";
import type { LocationSample } from "../../shared/contracts";
import { validLocationSample } from "../pipeline/location";
import { savePendingBackgroundLocationSample } from "./storage.native";

export const BACKGROUND_LOCATION_TASK = "yoin-first-recording-location";

export type ActiveLocationCapture = {
  uid: string;
  draftId: string;
  clipId: string;
  recordedAt: string;
};

type BackgroundLocationTaskData = {
  locations?: Location.LocationObject[];
};

const contextDatabase = openDatabaseAsync("location-capture-context.db").then(
  async (database) => {
    await database.execAsync(
      "CREATE TABLE IF NOT EXISTS active_capture (id INTEGER PRIMARY KEY CHECK (id = 1), uid TEXT NOT NULL, draft_id TEXT NOT NULL, clip_id TEXT NOT NULL, recorded_at TEXT NOT NULL);",
    );
    return database;
  },
);

export async function setActiveLocationCapture(capture: ActiveLocationCapture) {
  const database = await contextDatabase;
  await database.withExclusiveTransactionAsync(async (transaction) => {
    await transaction.runAsync(
      "INSERT INTO active_capture (id, uid, draft_id, clip_id, recorded_at) VALUES (1, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET uid = excluded.uid, draft_id = excluded.draft_id, clip_id = excluded.clip_id, recorded_at = excluded.recorded_at",
      capture.uid,
      capture.draftId,
      capture.clipId,
      capture.recordedAt,
    );
  });
}

export async function getActiveLocationCapture(): Promise<ActiveLocationCapture | null> {
  const database = await contextDatabase;
  const row = await database.getFirstAsync<{
    uid: string;
    draft_id: string;
    clip_id: string;
    recorded_at: string;
  }>(
    "SELECT uid, draft_id, clip_id, recorded_at FROM active_capture WHERE id = 1",
  );
  return row
    ? {
        uid: row.uid,
        draftId: row.draft_id,
        clipId: row.clip_id,
        recordedAt: row.recorded_at,
      }
    : null;
}

export async function clearActiveLocationCapture(
  expected?: Pick<ActiveLocationCapture, "uid" | "clipId">,
) {
  const database = await contextDatabase;
  await database.withExclusiveTransactionAsync(async (transaction) => {
    if (expected) {
      await transaction.runAsync(
        "DELETE FROM active_capture WHERE id = 1 AND uid = ? AND clip_id = ?",
        expected.uid,
        expected.clipId,
      );
      return;
    }
    await transaction.runAsync("DELETE FROM active_capture WHERE id = 1");
  });
}

export async function stopBackgroundLocationTask() {
  if (await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK))
    await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
}

function sampleFromLocation(
  location: Location.LocationObject,
): LocationSample | null {
  const sample: LocationSample = {
    latitude: location.coords.latitude,
    longitude: location.coords.longitude,
    accuracy: location.coords.accuracy ?? Number.NaN,
    timestamp: Math.trunc(location.timestamp),
  };
  return validLocationSample(sample) ? sample : null;
}

TaskManager.defineTask<BackgroundLocationTaskData>(
  BACKGROUND_LOCATION_TASK,
  async ({ data, error }) => {
    const capture = await getActiveLocationCapture();
    if (!capture) {
      await stopBackgroundLocationTask();
      return;
    }
    if (error) return;
    const recordingStartedAt = Date.parse(capture.recordedAt);
    const sample = data?.locations
      ?.map(sampleFromLocation)
      .find(
        (value): value is LocationSample =>
          value !== null &&
          Number.isSafeInteger(recordingStartedAt) &&
          value.timestamp >= recordingStartedAt,
      );
    if (!sample) return;

    await savePendingBackgroundLocationSample(
      capture.uid,
      capture.draftId,
      capture.clipId,
      sample,
    );
    try {
      await stopBackgroundLocationTask();
    } finally {
      await clearActiveLocationCapture(capture);
    }
  },
);

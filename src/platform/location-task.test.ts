import assert from "node:assert/strict";
import test from "node:test";
import { eraseMemoryLocationCapture } from "./locationTask.ts";

test("the web location-task fallback safely ignores native capture cleanup", async () => {
  await assert.doesNotReject(eraseMemoryLocationCapture("user", "draft"));
});

import assert from "node:assert/strict";
import test from "node:test";
import { createMediaServer } from "./server.mjs";

test("Firebase account deletion is protected and idempotent for an already removed user", async () => {
  const removed = [];
  const token = "t".repeat(64);
  const server = createMediaServer({
    token,
    origin: "https://yoin.test",
    deleteFirebaseUser: async (uid) => {
      removed.push(uid);
      if (removed.length > 1)
        throw Object.assign(new Error("removed"), {
          code: "auth/user-not-found",
        });
    },
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}/accounts/delete`;
    assert.equal(
      (await fetch(url, { method: "POST", body: "{}" })).status,
      401,
    );
    const options = {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ uid: "alice" }),
    };
    assert.equal((await fetch(url, options)).status, 200);
    assert.equal((await fetch(url, options)).status, 200);
    assert.deepEqual(removed, ["alice", "alice"]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

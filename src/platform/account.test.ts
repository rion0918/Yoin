import assert from "node:assert/strict";
import test from "node:test";
import { accountStorageKey, createAccountScope } from "./account.ts";

test("different accounts never share a storage key, including path characters", () => {
  assert.notEqual(accountStorageKey("alice"), accountStorageKey("bob"));
  assert.notEqual(accountStorageKey("a/b"), accountStorageKey("a%2Fb"));
  assert.ok(!accountStorageKey("a/b").includes("/"));
});
test("a response after logout cannot commit into the next account", async () => {
  const alice = createAccountScope("alice");
  const bob = createAccountScope("bob");
  let release: () => void = () => {};
  const result = new Promise<void>((resolve) => {
    release = resolve;
  });
  let committed = false;
  const pending = result.then(() => {
    alice.assertActive();
    committed = true;
  });
  alice.close();
  release();
  await assert.rejects(pending, /アカウント/);
  assert.equal(committed, false);
  assert.equal(alice.signal.aborted, true);
  bob.assertActive();
});

test("invalidating a deleted account closes its scope and waits for recording shutdown", async () => {
  const { invalidateAccountScopes } = await import("./account.ts");
  let release: () => void = () => {};
  let stopped = false;
  const account = createAccountScope("removed", async () => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    stopped = true;
  });
  const pending = invalidateAccountScopes("removed");
  assert.equal(account.signal.aborted, true);
  release();
  await pending;
  assert.equal(stopped, true);
});

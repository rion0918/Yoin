import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { setupLocal } from "./setup-local.mjs";

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "yoin-setup-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, ".local"));
  await mkdir(join(directory, "backend"));
  await writeFile(
    join(directory, ".local/ai-budget-handoff.json"),
    JSON.stringify({ limitUsd: 10, remainingUsd: 9.42 }),
  );
  return directory;
}
test("setup keeps service credentials private and uses only the handed-off budget", async (t) => {
  const project = await fixture(t);
  assert.deepEqual(await setupLocal(project), { remainingUsd: 9.42 });
  const env = await readFile(join(project, "backend/.dev.vars"), "utf8");
  assert.match(env, /FIREBASE_PROJECT_ID=yoin-app-20261004/);
  assert.match(env, /ALLOWED_TESTER_EMAILS=\[\]/);
  assert.equal(env.includes("TESTER_TOKEN"), false);
  await assert.rejects(stat(join(project, ".local/tester-token.txt")), {
    code: "ENOENT",
  });
  assert.match(env, /AI_BUDGET_USD=9.42/);
  assert.match(env, /MEDIA_SERVICE_URL=http:\/\/127.0.0.1:8080/);
  assert.equal(env.includes("GEMINI_API_KEY"), false);
  const runtime = await readFile(join(project, ".local/media.env"), "utf8");
  assert.match(runtime, /GEMINI_API_KEY=/);
  assert.match(runtime, /MEDIA_ORIGIN=http:\/\/host.docker.internal:8787/);
  assert.equal(
    runtime.match(/MEDIA_SERVICE_TOKEN=(.+)/)[1],
    env.match(/MEDIA_SERVICE_TOKEN=(.+)/)[1],
  );
  assert.equal(
    (await stat(join(project, ".local/media.env"))).mode & 0o777,
    0o600,
  );
  assert.equal(
    (await stat(join(project, "backend/.dev.vars"))).mode & 0o777,
    0o600,
  );
});
test("an existing tester token prevents creating an incompatible backend connection", async (t) => {
  const project = await fixture(t);
  await writeFile(join(project, ".local/tester-token.txt"), "existing");
  await assert.rejects(setupLocal(project));
  await assert.rejects(stat(join(project, "backend/.dev.vars")), {
    code: "ENOENT",
  });
  assert.equal(
    await readFile(join(project, ".local/tester-token.txt"), "utf8"),
    "existing",
  );
});

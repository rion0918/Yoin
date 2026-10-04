import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
test("setup keeps tester credentials private and uses only the handed-off budget", async (t) => {
  const project = await fixture(t);
  assert.deepEqual(await setupLocal(project), { remainingUsd: 9.42 });
  const token = await readFile(
    join(project, ".local/tester-token.txt"),
    "utf8",
  );
  const env = await readFile(join(project, "backend/.dev.vars"), "utf8");
  assert.match(
    env,
    new RegExp(
      `TESTER_TOKEN_SHA256=${createHash("sha256").update(token).digest("hex")}`,
    ),
  );
  assert.match(env, /AI_BUDGET_USD=9.42/);
  assert.equal(env.includes(token), false);
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

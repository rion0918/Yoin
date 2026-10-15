import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const expoRequire = createRequire(require.resolve("expo/package.json"));
const urlCreatorPath = join(
  dirname(expoRequire.resolve("@expo/cli/package.json")),
  "build/src/start/server/UrlCreator.js",
);
const { scripts } = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);

test("Android startup keeps the dev-client URL on ADB loopback after LAN changes", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "yoin-android-start-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const adbLogPath = join(directory, "adb.log");
  await writeFile(
    join(directory, "adb"),
    `#!/bin/sh
if [ "$1" = "devices" ]; then
  printf 'List of devices attached\\nemulator-5554\\tdevice\\n'
else
  printf '%s\\n' "$*" >> "$YOIN_TEST_ADB_LOG"
fi
`,
    { mode: 0o755 },
  );
  await writeFile(
    join(directory, "expo"),
    `#!/usr/bin/env node
const { UrlCreator } = require(${JSON.stringify(urlCreatorPath)});
const hostType = process.argv.includes('--localhost') || process.env.REACT_NATIVE_PACKAGER_HOSTNAME === '127.0.0.1' ? 'localhost' : 'lan';
const creator = new UrlCreator({ scheme: 'exp+yoin', hostType }, { port: 8081 }, { address: process.env.YOIN_TEST_LAN_IP });
console.log(creator.constructDevClientUrl());
`,
    { mode: 0o755 },
  );
  for (const command of ["android", "android:device"]) {
    for (const address of ["10.125.118.61", "192.168.22.15"]) {
      await writeFile(adbLogPath, "");
      const result = spawnSync("sh", ["-c", scripts[command]], {
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${directory}:${process.env.PATH}`,
          REACT_NATIVE_PACKAGER_HOSTNAME: address,
          EXPO_PACKAGER_PROXY_URL: "",
          YOIN_TEST_ADB_LOG: adbLogPath,
          YOIN_TEST_LAN_IP: address,
        },
      });
      assert.equal(result.status, 0, result.stderr);
      if (command === "android") {
        assert.equal(
          await readFile(adbLogPath, "utf8"),
          "-s emulator-5554 reverse tcp:8081 tcp:8081\n",
        );
      }
      const url = new URL(result.stdout.trim());
      assert.equal(
        url.searchParams.get("url"),
        "http://127.0.0.1:8081",
        `${command} must not restore the LAN address ${address}`,
      );
    }
  }
});

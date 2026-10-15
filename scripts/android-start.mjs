import { spawn, spawnSync } from "node:child_process";

const port = "8081";
const listed = spawnSync("adb", ["devices", "-l"], {
  encoding: "utf8",
});
if (listed.error || listed.status !== 0) {
  console.error(
    `ADBを実行できません。Android SDKのplatform-toolsを確認してください。${listed.error ? ` (${listed.error.message})` : ""}`,
  );
  process.exit(1);
}

const serials = listed.stdout
  .split(/\r?\n/)
  .map((line) => line.match(/^(\S+)\s+device(?:\s|$)/)?.[1])
  .filter(Boolean);
if (serials.length === 0) {
  console.error(
    "接続済みのAndroid端末がありません。エミュレーターを起動してから再実行してください。",
  );
  process.exit(1);
}

for (const serial of serials) {
  const reversed = spawnSync(
    "adb",
    ["-s", serial, "reverse", `tcp:${port}`, `tcp:${port}`],
    { stdio: "inherit" },
  );
  if (reversed.error || reversed.status !== 0) {
    console.error(
      `ADBのポート転送を設定できませんでした (${serial}, ${port})。端末の接続状態を確認してください。`,
    );
    process.exit(1);
  }
}

const expo = spawn(
  "expo",
  ["start", "--android", "--localhost", "--port", port],
  {
    env: { ...process.env, REACT_NATIVE_PACKAGER_HOSTNAME: "127.0.0.1" },
    stdio: "inherit",
  },
);
expo.on("error", (error) => {
  console.error(`Expo CLIを起動できませんでした: ${error.message}`);
  process.exitCode = 1;
});
expo.on("exit", (code) => {
  process.exitCode = code ?? 1;
});

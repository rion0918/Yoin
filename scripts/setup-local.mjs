import { createHash, randomBytes } from "node:crypto";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export async function setupLocal(project) {
  const handoff = JSON.parse(
    await readFile(resolve(project, ".local/ai-budget-handoff.json"), "utf8"),
  );
  if (
    handoff.limitUsd !== 10 ||
    !Number.isFinite(handoff.remainingUsd) ||
    handoff.remainingUsd < 0 ||
    handoff.remainingUsd > 10
  )
    throw new Error("AI予算の引き継ぎ記録が不正です。");
  for (const path of [
    "backend/.dev.vars",
    ".local/tester-token.txt",
    ".local/media.env",
  ]) {
    const exists = await lstat(resolve(project, path))
      .then(() => true)
      .catch((error) => {
        if (error.code === "ENOENT") return false;
        throw error;
      });
    if (exists) throw new Error("既存の接続設定は上書きできません。");
  }
  // Never print the token or overwrite an existing connection.
  const token = randomBytes(32).toString("hex");
  const hash = createHash("sha256").update(token).digest("hex");
  const mediaToken = randomBytes(32).toString("hex");
  const settings = [
    `TESTER_TOKEN_SHA256=${hash}`,
    `MEDIA_SIGNING_SECRET=${randomBytes(32).toString("hex")}`,
    `MEDIA_SERVICE_TOKEN=${mediaToken}`,
    "MEDIA_SERVICE_URL=http://127.0.0.1:8080",
    `AI_BUDGET_USD=${handoff.remainingUsd}`,
    "PUBLIC_API_URL=http://localhost:8787",
    "MEDIA_API_URL=http://host.docker.internal:8787",
    "",
  ].join("\n");
  await mkdir(resolve(project, ".local"), { recursive: true, mode: 0o700 });
  await writeFile(resolve(project, "backend/.dev.vars"), settings, {
    mode: 0o600,
    flag: "wx",
  });
  await writeFile(resolve(project, ".local/tester-token.txt"), token, {
    mode: 0o600,
    flag: "wx",
  });
  await writeFile(
    resolve(project, ".local/media.env"),
    [
      `MEDIA_SERVICE_TOKEN=${mediaToken}`,
      "MEDIA_ORIGIN=http://host.docker.internal:8787",
      "GEMINI_API_KEY=",
      "",
    ].join("\n"),
    { mode: 0o600, flag: "wx" },
  );
  return { remainingUsd: handoff.remainingUsd };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const project = fileURLToPath(new URL("..", import.meta.url));
  setupLocal(project)
    .then(({ remainingUsd }) => {
      console.log(
        `設定を backend/.dev.vars と .local/media.env、端末用トークンを .local/tester-token.txt に保存しました。AI予算残額: $${remainingUsd.toFixed(4)}`,
      );
    })
    .catch(() => {
      console.error(
        "設定を作成できません。PoC完了後に npm run poc -- handoff を実行し、既存設定は上書きせず確認してください。",
      );
      process.exitCode = 1;
    });
}

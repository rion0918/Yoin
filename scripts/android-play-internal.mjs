import { spawn, spawnSync } from "node:child_process";
import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";

const packageName = "com.rion0918.yoin";
const playApi = "https://androidpublisher.googleapis.com/androidpublisher/v3";
const publisherScope = "https://www.googleapis.com/auth/androidpublisher";
const checkOnly = process.argv[2] === "--check";

function fail(message) {
  throw new Error(message);
}

function validateBuildConfig() {
  const appConfig = JSON.parse(
    readFileSync(new URL("../app.json", import.meta.url), "utf8"),
  ).expo;
  const easConfig = JSON.parse(
    readFileSync(new URL("../eas.json", import.meta.url), "utf8"),
  );
  if (appConfig.android?.package !== packageName) {
    fail(`app.json の Android package が ${packageName} と一致しません。`);
  }
  if (
    easConfig.cli?.appVersionSource !== "remote" ||
    easConfig.build?.playInternal?.autoIncrement !== true ||
    easConfig.build?.playInternal?.android?.buildType !== "app-bundle"
  ) {
    fail("eas.json の remote versionCode・自動採番・AAB設定が必要です。");
  }
}

function positiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    fail(`${label} が正の整数ではありません。`);
  }
  return parsed;
}

function easEnvironment() {
  const env = { ...process.env };
  delete env.GOOGLE_PLAY_SERVICE_ACCOUNT_KEY_FILE;
  delete env.GEMINI_API_KEY;
  return env;
}

function loadServiceAccount() {
  const keyPath = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_KEY_FILE;
  if (!keyPath) {
    fail(
      "GOOGLE_PLAY_SERVICE_ACCOUNT_KEY_FILE が未設定です。.env.local に Play API サービスアカウント JSON のパスを設定してください。",
    );
  }

  let serviceAccount;
  try {
    serviceAccount = JSON.parse(readFileSync(keyPath, "utf8"));
  } catch {
    fail("Google Play API サービスアカウント JSON を読み込めません。");
  }

  if (
    typeof serviceAccount.client_email !== "string" ||
    typeof serviceAccount.private_key !== "string" ||
    typeof serviceAccount.token_uri !== "string" ||
    new URL(serviceAccount.token_uri).protocol !== "https:"
  ) {
    fail("Google Play API サービスアカウント JSON の形式が不正です。");
  }
  return serviceAccount;
}

function base64Url(value) {
  return Buffer.from(value).toString("base64url");
}

async function getAccessToken(serviceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const unsignedJwt = [
    base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" })),
    base64Url(
      JSON.stringify({
        iss: serviceAccount.client_email,
        scope: publisherScope,
        aud: serviceAccount.token_uri,
        iat: now,
        exp: now + 3600,
      }),
    ),
  ].join(".");
  const signer = createSign("RSA-SHA256");
  signer.update(unsignedJwt);
  signer.end();
  const assertion = `${unsignedJwt}.${signer.sign(serviceAccount.private_key).toString("base64url")}`;

  const response = await fetch(serviceAccount.token_uri, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!response.ok) {
    fail(
      `Google OAuth のトークン取得に失敗しました (HTTP ${response.status})。`,
    );
  }
  const token = await response.json();
  if (typeof token.access_token !== "string") {
    fail("Google OAuth の応答に access_token がありません。");
  }
  return token.access_token;
}

async function playRequest(accessToken, path, { method = "GET", body } = {}) {
  const response = await fetch(`${playApi}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${accessToken}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    fail(
      `Google Play Developer API の照会に失敗しました (HTTP ${response.status})。`,
    );
  }
  const text = await response.text();
  return text ? JSON.parse(text) : {};
}

function addCode(codes, value) {
  if (value !== undefined && value !== null) {
    codes.push(positiveInteger(value, "Play Console versionCode"));
  }
}

async function getPlayMaximumVersionCode(accessToken) {
  const appPath = `/applications/${encodeURIComponent(packageName)}`;
  const edit = await playRequest(accessToken, `${appPath}/edits`, {
    method: "POST",
    body: {},
  });
  if (typeof edit.id !== "string" || edit.id.length === 0) {
    fail("Google Play Developer API が照会用 edit ID を返しませんでした。");
  }

  let maximumVersionCode;
  let primaryError;
  try {
    const editPath = `${appPath}/edits/${encodeURIComponent(edit.id)}`;
    const [bundleList, trackList] = await Promise.all([
      playRequest(accessToken, `${editPath}/bundles`),
      playRequest(accessToken, `${editPath}/tracks`),
    ]);
    const codes = [];
    for (const bundle of bundleList.bundles ?? []) {
      addCode(codes, bundle.versionCode);
    }
    for (const track of trackList.tracks ?? []) {
      for (const release of track.releases ?? []) {
        for (const versionCode of release.versionCodes ?? []) {
          addCode(codes, versionCode);
        }
      }
    }
    maximumVersionCode = codes.length > 0 ? Math.max(...codes) : null;
  } catch (error) {
    primaryError = error;
  }

  try {
    await playRequest(
      accessToken,
      `${appPath}/edits/${encodeURIComponent(edit.id)}`,
      {
        method: "DELETE",
      },
    );
  } catch (cleanupError) {
    if (primaryError) {
      console.error(
        `照会用 edit の削除にも失敗しました: ${cleanupError.message}`,
      );
    } else {
      primaryError = cleanupError;
    }
  }

  if (primaryError) throw primaryError;
  return maximumVersionCode;
}

function runEasJson(commandArgs) {
  const result = spawnSync("npx", ["--yes", "eas-cli@latest", ...commandArgs], {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    env: easEnvironment(),
  });
  if (result.error) {
    fail(`EAS CLI を起動できません: ${result.error.message}`);
  }
  if (result.status !== 0) {
    fail(
      `EAS CLI の versionCode 取得に失敗しました。${result.stderr?.trim() ?? ""}`,
    );
  }
  let resultJson;
  try {
    resultJson = JSON.parse(result.stdout);
  } catch {
    fail("EAS CLI が versionCode を JSON で返しませんでした。");
  }
  return resultJson.versionCode == null
    ? null
    : positiveInteger(resultJson.versionCode, "EAS remote versionCode");
}

function runEasBuild() {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "npx",
      [
        "--yes",
        "eas-cli@latest",
        "build",
        "--platform",
        "android",
        "--profile",
        "playInternal",
        "--non-interactive",
      ],
      { stdio: "inherit", env: easEnvironment() },
    );
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(
            `EAS Build が終了しました (code=${code}, signal=${signal ?? "none"})。`,
          ),
        );
      }
    });
  });
}

async function main() {
  if (process.argv.length > 3 || (process.argv[2] && !checkOnly)) {
    fail("使い方: node scripts/android-play-internal.mjs [--check]");
  }

  validateBuildConfig();
  const serviceAccount = loadServiceAccount();
  const accessToken = await getAccessToken(serviceAccount);
  const playMaximum = await getPlayMaximumVersionCode(accessToken);
  const easCurrent = runEasJson([
    "build:version:get",
    "--platform",
    "android",
    "--profile",
    "playInternal",
    "--json",
    "--non-interactive",
  ]);

  if (easCurrent === null) {
    const playInfo =
      playMaximum === null
        ? "Play Console に既存 versionCode はありません"
        : `Play Console の最大値は ${playMaximum} です`;
    fail(
      `EAS remote versionCode が未初期化です。${playInfo}。先に npx eas-cli build:version:set --platform android --profile playInternal で初期値を設定してください。`,
    );
  }

  const nextVersionCode = easCurrent + 1;
  if (playMaximum !== null && nextVersionCode <= playMaximum) {
    fail(
      `重複する versionCode を避けるためビルドを停止しました。EAS 現在値 ${easCurrent} の次番号 ${nextVersionCode} が Play Console 最大値 ${playMaximum} 以下です。npx eas-cli build:version:set --platform android --profile playInternal で EAS を ${playMaximum} に合わせてから再実行してください。`,
    );
  }

  console.log(
    `versionCode 照合 OK: Play 最大 ${playMaximum ?? "なし"} / EAS 現在 ${easCurrent} / 次回予定 ${nextVersionCode}`,
  );
  if (checkOnly) {
    console.log("確認のみのため EAS Build は開始していません。");
    return;
  }
  await runEasBuild();
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

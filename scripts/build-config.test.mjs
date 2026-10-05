import assert from "node:assert/strict";
import test from "node:test";
import { validateDistribution } from "./build-config.cjs";

const env = {
  EXPO_PUBLIC_API_URL: "https://api.yoin.test",
  EXPO_PUBLIC_FIREBASE_PROJECT_ID: "yoin-project",
  EAS_PROJECT_ID: "8c7a3e3a-b5e8-4986-8491-a1a2c64e4e1f",
};
const services = {
  project_info: { project_id: "yoin-project", project_number: "123456" },
  client: [
    {
      api_key: [{ current_key: "AIzaTestConfiguration" }],
      client_info: {
        mobilesdk_app_id: "1:123456:android:abcdef",
        android_client_info: { package_name: "com.rion0918.yoin" },
      },
      oauth_client: [
        { client_type: 3, client_id: "web.apps.googleusercontent.com" },
      ],
    },
  ],
};
test("Play builds require HTTPS, the correct Firebase project/package and a Web OAuth client", () => {
  assert.doesNotThrow(() => validateDistribution(env, services));
  for (const invalid of [
    {},
    { ...env, EXPO_PUBLIC_API_URL: "http://localhost:8787" },
    { ...env, EXPO_PUBLIC_FIREBASE_PROJECT_ID: "other" },
  ])
    assert.throws(() => validateDistribution(invalid, services));
  assert.throws(() => validateDistribution(env, { ...services, client: [] }));
  assert.throws(() =>
    validateDistribution(env, {
      ...services,
      client: [{ ...services.client[0], oauth_client: [] }],
    }),
  );
});

test("distribution rejects Firebase files missing native app or API settings", () => {
  const missing = structuredClone(services);
  delete missing.client[0].api_key;
  assert.throws(() => validateDistribution(env, missing));
  const missingApp = structuredClone(services);
  delete missingApp.client[0].client_info.mobilesdk_app_id;
  assert.throws(() => validateDistribution(env, missingApp));
});

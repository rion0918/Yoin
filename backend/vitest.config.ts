import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      miniflare: {
        compatibilityDate: "2026-10-01",
        compatibilityFlags: ["nodejs_compat"],
        d1Databases: ["DB"],
        r2Buckets: ["AUDIO"],
        bindings: {
          FIREBASE_PROJECT_ID: "yoin-auth-test",
          ALLOWED_TESTER_EMAILS: '["tester@example.com"]',
          AI_BUDGET_USD: "10",
          PUBLIC_API_URL: "https://yoin.test",
        },
      },
    }),
  ],
  test: { include: ["tests/**/*.test.ts"], fileParallelism: false },
});

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
          OWNER_ID: "private-tester",
          AI_BUDGET_USD: "10",
          PUBLIC_API_URL: "https://yoin.test",
        },
      },
    }),
  ],
  test: { include: ["tests/**/*.test.ts"], fileParallelism: false },
});

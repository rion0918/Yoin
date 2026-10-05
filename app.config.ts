import { existsSync, readFileSync } from "node:fs";
import type { ConfigContext } from "expo/config";

const { validateDistribution } = require("./scripts/build-config.cjs");
export default ({ config }: ConfigContext) => {
  const servicesFile =
    process.env.GOOGLE_SERVICES_JSON ?? "./google-services.json";
  const distributing = process.env.EAS_BUILD_PROFILE === "playInternal";
  if (distributing) {
    if (!existsSync(servicesFile))
      throw new Error("配布にはgoogle-services.jsonが必要です。");
    validateDistribution(
      process.env,
      JSON.parse(readFileSync(servicesFile, "utf8")),
    );
  }
  return {
    ...config,
    android: {
      ...config.android,
      ...(existsSync(servicesFile) ? { googleServicesFile: servicesFile } : {}),
    },
    plugins: [
      ...(config.plugins ?? []),
      "@react-native-firebase/app",
      "@react-native-firebase/auth",
      ...(existsSync(servicesFile) ? ["react-native-nitro-google-signin"] : []),
    ],
    extra: {
      ...config.extra,
      ...(process.env.EAS_PROJECT_ID
        ? { eas: { projectId: process.env.EAS_PROJECT_ID } }
        : {}),
    },
  };
};

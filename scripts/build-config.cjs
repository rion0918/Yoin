function validateDistribution(env, services) {
  const url = new URL(env.EXPO_PUBLIC_API_URL);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  )
    throw new Error("配布用APIにはHTTPS URLが必要です。");
  if (
    !env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ||
    services.project_info?.project_id !== env.EXPO_PUBLIC_FIREBASE_PROJECT_ID
  )
    throw new Error("Firebaseプロジェクト設定が一致しません。");
  const client = services.client?.find(
    (value) =>
      value.client_info?.android_client_info?.package_name ===
      "com.rion0918.yoin",
  );
  const number = services.project_info?.project_number;
  if (
    typeof number !== "string" ||
    !/^\d+$/.test(number) ||
    !client?.client_info?.mobilesdk_app_id?.startsWith(
      `1:${number}:android:`,
    ) ||
    !client?.api_key?.some(
      (value) =>
        typeof value.current_key === "string" && value.current_key.length > 0,
    )
  )
    throw new Error(
      "FirebaseのアプリID・プロジェクト番号・API設定が必要です。",
    );
  if (
    !client?.oauth_client?.some(
      (value) =>
        value.client_type === 3 &&
        value.client_id?.endsWith(".apps.googleusercontent.com"),
    )
  )
    throw new Error("FirebaseのAndroid登録とWeb OAuthクライアントが必要です。");
  if (
    !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(
      env.EAS_PROJECT_ID ?? "",
    )
  )
    throw new Error("EASプロジェクトIDが必要です。");
}
module.exports = { validateDistribution };

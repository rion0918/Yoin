import type { SessionIdentity } from "./types";
export function observeIdentity(
  receive: (identity: SessionIdentity | null) => void,
) {
  receive(null);
  return () => {};
}
export async function signInGoogle() {
  throw new Error("GoogleログインはAndroidアプリでご利用ください。");
}
export async function reauthenticateGoogle(_uid: string) {
  return false;
}
export async function signOutGoogle() {}

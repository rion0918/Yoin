import {
  GoogleAuthProvider,
  getAuth,
  getIdToken,
  onAuthStateChanged,
  reauthenticateWithCredential,
  signInWithCredential,
  signOut,
} from "@react-native-firebase/auth";
import {
  GoogleOneTapSignIn,
  isCancelledResponse,
  isSuccessResponse,
} from "react-native-nitro-google-signin";
import { invalidateAccountScopes } from "../platform/account";
import { eraseLibrary } from "../platform/storage.native";
import type { SessionIdentity } from "./types";

let configured = false;
function configure() {
  if (!configured) {
    GoogleOneTapSignIn.configure({ webClientId: "autoDetect" });
    configured = true;
  }
}
export function observeIdentity(
  receive: (identity: SessionIdentity | null) => void,
) {
  return onAuthStateChanged(getAuth(), (user) => {
    receive(
      user
        ? {
            uid: user.uid,
            email: user.email ?? "",
            name: user.displayName ?? "",
            getIdToken: async (forceRefresh) => {
              try {
                return await getIdToken(user, forceRefresh);
              } catch (error) {
                const code = (error as { code?: string }).code;
                if (
                  code === "auth/user-not-found" ||
                  code === "auth/user-disabled"
                ) {
                  await invalidateAccountScopes(user.uid);
                  if (code === "auth/user-not-found")
                    await eraseLibrary(user.uid);
                  await signOut(getAuth());
                }
                throw new Error(
                  "ログインを確認できません。通信を確認して、もう一度ログインしてください。",
                );
              }
            },
          }
        : null,
    );
  });
}
async function googleCredential() {
  configure();
  await GoogleOneTapSignIn.checkPlayServices();
  const response = await GoogleOneTapSignIn.presentExplicitSignIn();
  if (isCancelledResponse(response)) return null;
  if (!isSuccessResponse(response) || !response.data.idToken)
    throw new Error(
      "Googleでログインできませんでした。もう一度お試しください。",
    );
  return GoogleAuthProvider.credential(response.data.idToken);
}
export async function signInGoogle() {
  const credential = await googleCredential();
  if (credential) await signInWithCredential(getAuth(), credential);
}
export async function reauthenticateGoogle(uid: string) {
  const user = getAuth().currentUser;
  if (!user || user.uid !== uid)
    throw new Error("もう一度ログインしてください。");
  const credential = await googleCredential();
  if (!credential) return false;
  await reauthenticateWithCredential(user, credential);
  await getIdToken(user, true);
  return true;
}
export async function signOutGoogle() {
  await signOut(getAuth());
  if (configured) await GoogleOneTapSignIn.signOut();
}

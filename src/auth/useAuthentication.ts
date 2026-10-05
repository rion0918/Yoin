import { useEffect, useState } from "react";
import {
  observeIdentity,
  reauthenticateGoogle,
  signInGoogle,
  signOutGoogle,
} from "./provider";
import type { SessionIdentity } from "./types";

export function useAuthentication() {
  const [identity, setIdentity] = useState<SessionIdentity | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    try {
      return observeIdentity((next) => {
        setIdentity(next);
        setReady(true);
      });
    } catch {
      setReady(true);
      setError(
        "アプリを開けませんでした。時間をおいて、もう一度お試しください。",
      );
    }
  }, []);
  async function run(action: () => Promise<unknown>) {
    if (busy) return false;
    setBusy(true);
    setError(null);
    try {
      await action();
      return true;
    } catch {
      setError(
        "ログインを確認できませんでした。通信を確認して、もう一度お試しください。",
      );
      return false;
    } finally {
      setBusy(false);
    }
  }
  return {
    identity,
    ready,
    busy,
    error,
    signIn: () => run(signInGoogle),
    signOut: () => run(signOutGoogle),
    reauthenticate: (uid: string) => reauthenticateGoogle(uid),
  };
}

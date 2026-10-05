export function accountStorageKey(uid: string) {
  if (!uid) throw new Error("アカウントを確認できません。");
  return `user-${encodeURIComponent(uid)}`;
}
type Scope = { controller: AbortController; shutdown?: () => Promise<void> };
const scopes = new Map<string, Set<Scope>>();
export async function invalidateAccountScopes(uid: string) {
  const active = scopes.get(uid) ?? new Set<Scope>();
  for (const scope of active) scope.controller.abort();
  await Promise.all([...active].map((scope) => scope.shutdown?.()));
  scopes.delete(uid);
}
export function createAccountScope(
  uid: string,
  shutdown?: () => Promise<void>,
) {
  const controller = new AbortController();
  const active = scopes.get(uid) ?? new Set<Scope>();
  const scope = { controller, shutdown };
  active.add(scope);
  scopes.set(uid, active);
  return {
    uid,
    signal: controller.signal,
    assertActive() {
      if (controller.signal.aborted)
        throw new Error("アカウントが切り替わりました。");
    },
    close: () => {
      controller.abort();
      active.delete(scope);
      if (!active.size) scopes.delete(uid);
    },
  };
}

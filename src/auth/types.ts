export type SessionIdentity = {
  uid: string;
  email: string;
  name: string;
  getIdToken: (forceRefresh?: boolean) => Promise<string>;
};

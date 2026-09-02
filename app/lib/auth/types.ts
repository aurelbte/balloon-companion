export type AuthState = "UNKNOWN" | "SIGNED_OUT" | "SIGNED_IN" | "OFFLINE_SESSION";

export type BalloonUser = Readonly<{
  id: string;
  email: string;
  firstName: string;
  lastName: string;
}>;

export type DeviceIdentity = Readonly<{
  deviceId: string;
  createdAt: string;
  lastSeenAt: string;
}>;

export type AuthCredentials = Readonly<{
  email: string;
  password: string;
}>;

export type SignUpInput = AuthCredentials & Readonly<{
  firstName: string;
  lastName: string;
}>;

export interface AuthProvider {
  getCurrentUser(): Promise<BalloonUser | null>;
  signUp(input: SignUpInput): Promise<BalloonUser>;
  signIn(input: AuthCredentials): Promise<BalloonUser>;
  signOut(): Promise<void>;
  restoreSession(): Promise<BalloonUser | null>;
  requestPasswordReset(email: string): Promise<void>;
  recoverPassword(code: string, password: string): Promise<void>;
}

export type AuthSnapshot = Readonly<{
  state: AuthState;
  user: BalloonUser | null;
}>;

export const UNKNOWN_AUTH_SNAPSHOT: AuthSnapshot = Object.freeze({
  state: "UNKNOWN",
  user: null,
});

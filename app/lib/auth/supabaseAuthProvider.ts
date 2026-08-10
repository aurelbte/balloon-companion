import type { User } from "@supabase/supabase-js";
import type { AuthCredentials, AuthProvider, BalloonUser, SignUpInput } from "./types.ts";

type AuthResult = Promise<Readonly<{
  data: Readonly<{ user: User | null }>;
  error: Readonly<{ message: string; code?: string; status?: number }> | null;
}>>;

export type SupabaseAuthClient = Readonly<{
  auth: Readonly<{
    getUser(): AuthResult;
    signUp(input: Readonly<{
      email: string;
      password: string;
      options: Readonly<{
        data: Readonly<{ firstName: string; lastName: string }>;
        emailRedirectTo: string;
      }>;
    }>): AuthResult;
    signInWithPassword(input: AuthCredentials): AuthResult;
    signOut(options: Readonly<{ scope: "local" }>): Promise<Readonly<{ error: Readonly<{ message: string }> | null }>>;
    exchangeCodeForSession(code: string): AuthResult;
  }>;
}>;

export class BalloonAuthError extends Error {
  readonly code: string | null;
  readonly status: number | null;

  constructor(error?: Readonly<{ message: string; code?: string; status?: number }>) {
    super(error?.message ?? "AUTH_OPERATION_FAILED");
    this.name = "BalloonAuthError";
    this.code = error?.code ?? null;
    this.status = error?.status ?? null;
  }
}

function toBalloonUser(user: User | null): BalloonUser | null {
  if (!user?.email) return null;
  return {
    id: user.id,
    email: user.email.toLocaleLowerCase("fr-FR"),
    firstName: typeof user.user_metadata.firstName === "string" ? user.user_metadata.firstName : "",
    lastName: typeof user.user_metadata.lastName === "string" ? user.user_metadata.lastName : "",
  };
}

function requiredUser(user: User | null, error: unknown): BalloonUser {
  const balloonUser = toBalloonUser(user);
  if (error || !balloonUser) throw new BalloonAuthError();
  return balloonUser;
}

export class SupabaseAuthProvider implements AuthProvider {
  private readonly client: SupabaseAuthClient;
  private readonly getOrigin: () => string;

  constructor(client: SupabaseAuthClient, getOrigin: () => string = () => window.location.origin) {
    this.client = client;
    this.getOrigin = getOrigin;
  }

  async getCurrentUser(): Promise<BalloonUser | null> {
    const { data, error } = await this.client.auth.getUser();
    if (error) throw new BalloonAuthError();
    return toBalloonUser(data.user);
  }

  async signUp(input: SignUpInput): Promise<BalloonUser> {
    console.log("[Supabase Auth signUp input.email]", {
      email: JSON.stringify(input.email),
      length: input.email.length,
    });
    const { data, error } = await this.client.auth.signUp({
      email: input.email,
      password: input.password,
      options: {
        data: { firstName: input.firstName, lastName: input.lastName },
        emailRedirectTo: `${this.getOrigin()}/auth/confirmed`,
      },
    });
    if (error) {
      console.error("[Supabase Auth signUp]", {
        message: error.message,
        code: error.code ?? null,
        status: error.status ?? null,
      });
      throw new BalloonAuthError(error);
    }
    return requiredUser(data.user, null);
  }

  async signIn(input: AuthCredentials): Promise<BalloonUser> {
    const { data, error } = await this.client.auth.signInWithPassword(input);
    return requiredUser(data.user, error);
  }

  async signOut(): Promise<void> {
    const { error } = await this.client.auth.signOut({ scope: "local" });
    if (error) throw new BalloonAuthError();
  }

  restoreSession(): Promise<BalloonUser | null> {
    return this.getCurrentUser();
  }

  async confirmEmail(code?: string): Promise<BalloonUser | null> {
    const current = await this.client.auth.getUser();
    const currentUser = toBalloonUser(current.data.user);
    if (!current.error && currentUser) return currentUser;
    if (!code) return null;
    const exchanged = await this.client.auth.exchangeCodeForSession(code);
    const exchangedUser = toBalloonUser(exchanged.data.user);
    if (!exchanged.error && exchangedUser) return exchangedUser;
    const restored = await this.client.auth.getUser();
    return restored.error ? null : toBalloonUser(restored.data.user);
  }
}

import type { User } from "@supabase/supabase-js";
import type { AuthCredentials, AuthProvider, BalloonUser, SignUpInput } from "./types.ts";

type AuthResult = Promise<Readonly<{
  data: Readonly<{ user: User | null }>;
  error: Readonly<{ message: string }> | null;
}>>;

export type SupabaseAuthClient = Readonly<{
  auth: Readonly<{
    getUser(): AuthResult;
    signUp(input: Readonly<{
      email: string;
      password: string;
      options: Readonly<{ data: Readonly<{ firstName: string; lastName: string }> }>;
    }>): AuthResult;
    signInWithPassword(input: AuthCredentials): AuthResult;
    signOut(options: Readonly<{ scope: "local" }>): Promise<Readonly<{ error: Readonly<{ message: string }> | null }>>;
  }>;
}>;

export class BalloonAuthError extends Error {
  constructor() {
    super("AUTH_OPERATION_FAILED");
    this.name = "BalloonAuthError";
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

  constructor(client: SupabaseAuthClient) {
    this.client = client;
  }

  async getCurrentUser(): Promise<BalloonUser | null> {
    const { data, error } = await this.client.auth.getUser();
    if (error) throw new BalloonAuthError();
    return toBalloonUser(data.user);
  }

  async signUp(input: SignUpInput): Promise<BalloonUser> {
    const { data, error } = await this.client.auth.signUp({
      email: input.email,
      password: input.password,
      options: { data: { firstName: input.firstName, lastName: input.lastName } },
    });
    return requiredUser(data.user, error);
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
}

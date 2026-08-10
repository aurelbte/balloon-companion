"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { clearLocalAuthSession, restoreAuthSnapshot, saveLocalAuthSession } from "../lib/auth/session.ts";
import { SupabaseAuthProvider } from "../lib/auth/supabaseAuthProvider.ts";
import type { AuthCredentials, AuthSnapshot, SignUpInput } from "../lib/auth/types.ts";
import { UNKNOWN_AUTH_SNAPSHOT } from "../lib/auth/types.ts";
import { createBrowserSupabaseClient } from "../lib/supabase/client.ts";

type AuthContextValue = AuthSnapshot & Readonly<{
  signUp(input: SignUpInput): Promise<void>;
  signIn(input: AuthCredentials): Promise<void>;
  signOut(): Promise<void>;
  confirmEmail(code?: string): Promise<boolean>;
}>;

const AuthContext = createContext<AuthContextValue | null>(null);

export function BalloonAuthProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const provider = useMemo(() => new SupabaseAuthProvider(createBrowserSupabaseClient()), []);
  const [snapshot, setSnapshot] = useState<AuthSnapshot>(UNKNOWN_AUTH_SNAPSHOT);

  useEffect(() => {
    let active = true;
    void restoreAuthSnapshot({ provider, storage: window.localStorage, online: navigator.onLine })
      .then((restored) => { if (active) setSnapshot(restored); });
    return () => { active = false; };
  }, [provider]);

  const signUp = useCallback(async (input: SignUpInput) => {
    await provider.signUp(input);
  }, [provider]);

  const signIn = useCallback(async (input: AuthCredentials) => {
    const user = await provider.signIn(input);
    saveLocalAuthSession(window.localStorage, user);
    setSnapshot({ state: "SIGNED_IN", user });
  }, [provider]);

  const signOut = useCallback(async () => {
    await provider.signOut();
    clearLocalAuthSession(window.localStorage);
    setSnapshot({ state: "SIGNED_OUT", user: null });
  }, [provider]);

  const confirmEmail = useCallback(async (code?: string) => {
    try {
      const user = await provider.confirmEmail(code);
      if (!user) {
        setSnapshot({ state: "SIGNED_OUT", user: null });
        return false;
      }
      saveLocalAuthSession(window.localStorage, user);
      setSnapshot({ state: "SIGNED_IN", user });
      return true;
    } catch {
      setSnapshot({ state: "SIGNED_OUT", user: null });
      return false;
    }
  }, [provider]);

  return <AuthContext.Provider value={{ ...snapshot, signUp, signIn, signOut, confirmEmail }}>{children}</AuthContext.Provider>;
}

export function useBalloonAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useBalloonAuth must be used inside BalloonAuthProvider");
  return context;
}

"use client";

import { createContext, Fragment, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { clearLocalAuthSession, restoreAuthSnapshot, saveLocalAuthSession } from "../lib/auth/session.ts";
import { SupabaseAuthProvider } from "../lib/auth/supabaseAuthProvider.ts";
import type { AuthCredentials, AuthSnapshot, SignUpInput } from "../lib/auth/types.ts";
import { UNKNOWN_AUTH_SNAPSHOT } from "../lib/auth/types.ts";
import { createBrowserSupabaseClient } from "../lib/supabase/client.ts";
import type { PendingLocalDataMigration } from "../lib/auth/dataScope.ts";
import { getOrCreateDeviceIdentity } from "../lib/auth/deviceIdentity.ts";
import { saveLocalDataMigrationDecision, type LocalDataMigrationDecision } from "../lib/auth/localDataMigrationDecision.ts";
import type { LocalDataMigrationState } from "../lib/auth/localDataMigration.ts";
import { migrateGuestAndLegacyToUser, type GuestToUserMigrationCollision } from "../lib/auth/guestToUserMigration.ts";
import { DATA_SCOPE_CHANGED_EVENT, setRuntimeAuthSnapshot, setRuntimeGuestModeActive } from "../lib/auth/dataScopeRuntime.ts";

type AuthContextValue = AuthSnapshot & Readonly<{
  signUp(input: SignUpInput): Promise<void>;
  signIn(input: AuthCredentials): Promise<void>;
  signOut(): Promise<void>;
  confirmEmail(code?: string): Promise<boolean>;
  pendingLocalDataMigration: PendingLocalDataMigration | null;
  decideLocalDataMigration(decision: LocalDataMigrationDecision): void;
  localDataMigrationState: LocalDataMigrationState | null;
  localDataMigrationCollisions: readonly GuestToUserMigrationCollision[];
  authChoiceState: "AUTH_CHOICE_PENDING" | "GUEST_ACTIVE";
  activateGuestMode(): void;
}>;

const AuthContext = createContext<AuthContextValue | null>(null);

export function BalloonAuthProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const provider = useMemo(() => new SupabaseAuthProvider(createBrowserSupabaseClient()), []);
  const pathname = usePathname();
  const [snapshot, setSnapshot] = useState<AuthSnapshot>(UNKNOWN_AUTH_SNAPSHOT);
  const [pendingLocalDataMigration, setPendingLocalDataMigration] = useState<PendingLocalDataMigration | null>(null);
  const [localDataMigrationState, setLocalDataMigrationState] = useState<LocalDataMigrationState | null>(null);
  const [localDataMigrationCollisions, setLocalDataMigrationCollisions] = useState<readonly GuestToUserMigrationCollision[]>([]);
  const [dataReadyUserId, setDataReadyUserId] = useState<string | null>(null);
  const [authChoiceState, setAuthChoiceState] = useState<"AUTH_CHOICE_PENDING" | "GUEST_ACTIVE">("AUTH_CHOICE_PENDING");
  setRuntimeAuthSnapshot(snapshot);
  setRuntimeGuestModeActive(authChoiceState === "GUEST_ACTIVE");

  useEffect(() => { window.dispatchEvent(new Event(DATA_SCOPE_CHANGED_EVENT)); }, [snapshot, authChoiceState]);

  useEffect(() => {
    if (pathname === "/auth/confirmed") return;
    let active = true;
    void restoreAuthSnapshot({ provider, storage: window.localStorage, online: navigator.onLine })
      .then((restored) => { if (active) setSnapshot(restored); });
    return () => { active = false; };
  }, [pathname, provider]);

  useEffect(() => {
    if ((snapshot.state !== "SIGNED_IN" && snapshot.state !== "OFFLINE_SESSION") || !snapshot.user) {
      setPendingLocalDataMigration(null); setDataReadyUserId(null); setLocalDataMigrationCollisions([]); return;
    }
    let active = true; const userId = snapshot.user.id;
    setDataReadyUserId(null); setLocalDataMigrationState("MIGRATION_COPYING");
    const deviceId = getOrCreateDeviceIdentity(window.localStorage).deviceId;
    void migrateGuestAndLegacyToUser({ userId, deviceId, storage: window.localStorage, factory: window.indexedDB })
      .then((report) => {
        if (!active || snapshot.user?.id !== userId) return;
        setLocalDataMigrationCollisions(report.collisions); setLocalDataMigrationState("MIGRATION_COMPLETE");
        setDataReadyUserId(userId); window.dispatchEvent(new Event(DATA_SCOPE_CHANGED_EVENT));
      })
      .catch(() => {
        if (!active) return;
        setLocalDataMigrationState({ state: "MIGRATION_FAILED", collection: "preferences", id: "GUEST_OR_LEGACY", reason: "COPY_FAILED" });
        setDataReadyUserId(userId);
      });
    return () => { active = false; };
  }, [snapshot]);

  const decideLocalDataMigration = useCallback((decision: LocalDataMigrationDecision) => {
    const migration = pendingLocalDataMigration;
    if (snapshot.state !== "SIGNED_IN" || !migration || snapshot.user?.id !== migration.userId) return;
    saveLocalDataMigrationDecision(window.localStorage, {
      userId: migration.userId,
      deviceId: migration.deviceId,
      decision,
    });
    setPendingLocalDataMigration(null);
  }, [pendingLocalDataMigration, snapshot]);

  const signUp = useCallback(async (input: SignUpInput) => {
    await provider.signUp(input);
  }, [provider]);

  const signIn = useCallback(async (input: AuthCredentials) => {
    const user = await provider.signIn(input);
    saveLocalAuthSession(window.localStorage, user);
    setAuthChoiceState("AUTH_CHOICE_PENDING");
    setSnapshot({ state: "SIGNED_IN", user });
  }, [provider]);

  const signOut = useCallback(async () => {
    await provider.signOut();
    clearLocalAuthSession(window.localStorage);
    setAuthChoiceState("AUTH_CHOICE_PENDING");
    setSnapshot({ state: "SIGNED_OUT", user: null });
  }, [provider]);

  const activateGuestMode = useCallback(() => {
    if (snapshot.state !== "SIGNED_OUT") return;
    setAuthChoiceState("GUEST_ACTIVE");
    setRuntimeGuestModeActive(true);
    window.dispatchEvent(new Event(DATA_SCOPE_CHANGED_EVENT));
  }, [snapshot.state]);

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

  const runtimeKey = snapshot.state === "SIGNED_IN" || snapshot.state === "OFFLINE_SESSION" ? `USER:${snapshot.user?.id}` : `${snapshot.state}:${authChoiceState}`;
  const userWaitingForMigration = (snapshot.state === "SIGNED_IN" || snapshot.state === "OFFLINE_SESSION") && snapshot.user && dataReadyUserId !== snapshot.user.id;
  const runtimeChildren = (snapshot.state === "UNKNOWN" && pathname !== "/auth/confirmed") || userWaitingForMigration ? null : <Fragment key={runtimeKey}>{children}</Fragment>;
  return <AuthContext.Provider value={{ ...snapshot, signUp, signIn, signOut, confirmEmail, pendingLocalDataMigration, decideLocalDataMigration, localDataMigrationState, localDataMigrationCollisions, authChoiceState, activateGuestMode }}>{runtimeChildren}</AuthContext.Provider>;
}

export function useBalloonAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useBalloonAuth must be used inside BalloonAuthProvider");
  return context;
}

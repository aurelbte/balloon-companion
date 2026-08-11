"use client";

import { createContext, Fragment, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { clearLocalAuthSession, restoreAuthSnapshot, saveLocalAuthSession } from "../lib/auth/session.ts";
import { SupabaseAuthProvider } from "../lib/auth/supabaseAuthProvider.ts";
import type { AuthCredentials, AuthSnapshot, SignUpInput } from "../lib/auth/types.ts";
import { UNKNOWN_AUTH_SNAPSHOT } from "../lib/auth/types.ts";
import { createBrowserSupabaseClient } from "../lib/supabase/client.ts";
import { createPendingLocalDataMigration, inspectLegacyLocalData, type PendingLocalDataMigration } from "../lib/auth/dataScope.ts";
import { getOrCreateDeviceIdentity } from "../lib/auth/deviceIdentity.ts";
import { getLocalDataMigrationDecision, saveLocalDataMigrationDecision, type LocalDataMigrationDecision } from "../lib/auth/localDataMigrationDecision.ts";
import { BrowserLocalDataMigrationRepository, hasCompletedLegacyMigration, migrateApprovedLegacyData, type LocalDataMigrationState } from "../lib/auth/localDataMigration.ts";
import { DATA_SCOPE_CHANGED_EVENT, setRuntimeAuthSnapshot, setRuntimeGuestModeActive } from "../lib/auth/dataScopeRuntime.ts";

type AuthContextValue = AuthSnapshot & Readonly<{
  signUp(input: SignUpInput): Promise<void>;
  signIn(input: AuthCredentials): Promise<void>;
  signOut(): Promise<void>;
  confirmEmail(code?: string): Promise<boolean>;
  pendingLocalDataMigration: PendingLocalDataMigration | null;
  decideLocalDataMigration(decision: LocalDataMigrationDecision): void;
  localDataMigrationState: LocalDataMigrationState | null;
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
  const [authChoiceState, setAuthChoiceState] = useState<"AUTH_CHOICE_PENDING" | "GUEST_ACTIVE">("AUTH_CHOICE_PENDING");
  setRuntimeAuthSnapshot(snapshot);
  setRuntimeGuestModeActive(authChoiceState === "GUEST_ACTIVE");

  useEffect(() => { window.dispatchEvent(new Event(DATA_SCOPE_CHANGED_EVENT)); }, [snapshot]);

  const startApprovedMigration = useCallback((userId: string, deviceId: string) => {
    setLocalDataMigrationState("MIGRATION_APPROVED");
    const repository = new BrowserLocalDataMigrationRepository(window.localStorage, window.indexedDB);
    void migrateApprovedLegacyData({ userId, deviceId, repository, onState: (state) => {
      setLocalDataMigrationState(state);
      if (state === "MIGRATION_COMPLETE") window.dispatchEvent(new Event(DATA_SCOPE_CHANGED_EVENT));
    } })
      .catch(() => setLocalDataMigrationState({ state: "MIGRATION_FAILED", collection: "preferences", id: "LEGACY_UNSCOPED", reason: "COPY_FAILED" }));
  }, []);

  useEffect(() => {
    if (pathname === "/auth/confirmed") return;
    let active = true;
    void restoreAuthSnapshot({ provider, storage: window.localStorage, online: navigator.onLine })
      .then((restored) => { if (active) setSnapshot(restored); });
    return () => { active = false; };
  }, [pathname, provider]);

  useEffect(() => {
    if (snapshot.state !== "SIGNED_IN" || !snapshot.user) { setPendingLocalDataMigration(null); return; }
    let active = true;
    const deviceId = getOrCreateDeviceIdentity(window.localStorage).deviceId;
    if (hasCompletedLegacyMigration(window.localStorage, snapshot.user.id, deviceId)) {
      setLocalDataMigrationState("MIGRATION_COMPLETE");
      setPendingLocalDataMigration(null);
      return;
    }
    const existingDecision = getLocalDataMigrationDecision(window.localStorage, snapshot.user.id, deviceId);
    if (existingDecision) {
      setPendingLocalDataMigration(null);
      if (existingDecision.decision === "MIGRATION_APPROVED") startApprovedMigration(snapshot.user.id, deviceId);
      return;
    }
    void inspectLegacyLocalData(window.localStorage, window.indexedDB)
      .then((legacyDataSummary) => {
        if (active) setPendingLocalDataMigration(createPendingLocalDataMigration({ snapshot, deviceId, legacyDataSummary }));
      });
    return () => { active = false; };
  }, [snapshot, startApprovedMigration]);

  const decideLocalDataMigration = useCallback((decision: LocalDataMigrationDecision) => {
    const migration = pendingLocalDataMigration;
    if (snapshot.state !== "SIGNED_IN" || !migration || snapshot.user?.id !== migration.userId) return;
    saveLocalDataMigrationDecision(window.localStorage, {
      userId: migration.userId,
      deviceId: migration.deviceId,
      decision,
    });
    setPendingLocalDataMigration(null);
    if (decision === "MIGRATION_APPROVED") startApprovedMigration(migration.userId, migration.deviceId);
  }, [pendingLocalDataMigration, snapshot, startApprovedMigration]);

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
  const runtimeChildren = snapshot.state === "UNKNOWN" && pathname !== "/auth/confirmed" ? null : <Fragment key={runtimeKey}>{children}</Fragment>;
  return <AuthContext.Provider value={{ ...snapshot, signUp, signIn, signOut, confirmEmail, pendingLocalDataMigration, decideLocalDataMigration, localDataMigrationState, authChoiceState, activateGuestMode }}>{runtimeChildren}</AuthContext.Provider>;
}

export function useBalloonAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useBalloonAuth must be used inside BalloonAuthProvider");
  return context;
}

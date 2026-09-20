import type { CloudSyncRuntimeControllerSnapshot } from "./cloudSyncRuntimeController.ts";
import { AUTOMATIC_SYNC_ENTITY_TYPES } from "./cloudSyncService.ts";
import type { SyncMutation } from "./syncOutbox.ts";
import type { CloudSyncIssue } from "./cloudSyncService.ts";
import type { FlightTrackJob } from "./flightTrackQueue.ts";

export const CLOUD_SYNC_BUSINESS_STORAGE_KEYS = new Set([
  "balloon-companion-pilot-profile", "balloon-companion-unit-preferences-v1", "balloon-companion-weather-preferences-v1",
  "balloon-companion-aviation-preferences-v1", "balloon-companion-pilot-qualifications-v1", "balloon-companion-balloons",
  "balloon-companion-favorite-launch-sites-v1", "balloon-companion-favorite-weather-places-v1", "balloon-companion-flight-completion-v1",
]);
export const CLOUD_SYNC_VERDICT_CHANGED_EVENT = "balloon-companion:sync-verdict-changed";
export const CLOUD_SYNC_VERDICT_SOURCE = Math.random().toString(36).slice(2);
let generation = 0;
let observationVersion = 0;
export function cloudSyncObservationVersion(): number { return observationVersion; }
export function invalidateCloudSyncObservation(): void { observationVersion += 1; notifyCloudSyncVerdict(); }
let channel: BroadcastChannel | null = null;
export function cloudSyncVerdictGeneration(): number { return generation; }
function notifyCloudSyncVerdict(broadcast = true, defer = false): void {
  const notify = () => {
    if (typeof window === "undefined") return;
    try { window.dispatchEvent(new Event(CLOUD_SYNC_VERDICT_CHANGED_EVENT)); } catch { /* Observation cannot break persistence. */ }
    if (broadcast && typeof window.BroadcastChannel === "function") {
      try { channel ??= new window.BroadcastChannel(CLOUD_SYNC_VERDICT_CHANGED_EVENT); channel.postMessage({ source: CLOUD_SYNC_VERDICT_SOURCE }); } catch { /* Inspection remains conservative. */ }
    }
  };
  if (defer) queueMicrotask(notify); else notify();
}
export function invalidateCloudSyncVerdict(broadcast = true, defer = false): void {
  generation += 1;
  notifyCloudSyncVerdict(broadcast, defer);
}
export function cloudSyncRuntimeToken(runtime: CloudSyncRuntimeControllerSnapshot): string {
  return JSON.stringify([runtime.scope, runtime.online, runtime.active, runtime.bootstrapInProgress, runtime.pushInProgress,
    runtime.lastBootstrapState, runtime.lastCompletedAt, runtime.lastPushState, runtime.lastPushCompletedAt, runtime.lastError,
    runtime.lastPushAuthorized, runtime.lastPushRefusalReason]);
}
export type CloudSyncValidation = Readonly<{ observation: number; runtime: string; activity: string }>;
export type CloudSyncVerdictState = "SYNCING" | "PENDING" | "OFFLINE_PENDING" | "ERROR" | "CONFLICT" | "UNVERIFIABLE" | "LOCAL_ONLY" | "SYNCED";
export type CloudSyncVerdict = Readonly<{ state: CloudSyncVerdictState; scope: string | null; generation: number; verifiedAt: string | null; bootstrapAt: string | null; reason: string; validation?: CloudSyncValidation; checking?: boolean }>;
export const CLOUD_SYNC_VERDICT_LABELS: Record<CloudSyncVerdictState, string> = {
  SYNCING: "Synchronisation en cours", PENDING: "Modifications en attente", OFFLINE_PENDING: "Hors ligne — modifications en attente",
  ERROR: "Erreur de synchronisation", CONFLICT: "Conflit à résoudre", UNVERIFIABLE: "État de synchronisation non vérifiable",
  LOCAL_ONLY: "Données locales — non connecté", SYNCED: "Données synchronisables synchronisées",
};
export type CloudSyncEvidence = Readonly<{
  mutations: readonly SyncMutation[]; intents: number; issues: readonly CloudSyncIssue[]; tracks: readonly FlightTrackJob[];
  traceActive: boolean; recoveryActive?: boolean; traceDiscoveryComplete: boolean; traceDiscoveryError?: string | null; coverageComplete: boolean; passGeneration: number | null;
}>;
export function isCloudSyncConflictIssue(issue: Pick<CloudSyncIssue, "kind">): boolean {
  return issue.kind === "CONFLICT" || issue.kind === "BUSINESS_CONFLICT";
}
export function isCloudSyncConflictMutation(mutation: Pick<SyncMutation, "lastErrorCode">): boolean {
  return mutation.lastErrorCode === "CONFLICT" || mutation.lastErrorCode === "DUPLICATE_REGISTRATION";
}
export async function inspectCloudSyncVerdict(input: Readonly<{
  getScope(): string | null; getGeneration(): number; runtime(): CloudSyncRuntimeControllerSnapshot;
  getObservationVersion?(): number; activityToken?(): string;
  online(): boolean; authKnown?(): boolean; read(scope: `USER:${string}`): Promise<CloudSyncEvidence>;
}>): Promise<CloudSyncVerdict> {
  const scope = input.getScope(), captured = input.getGeneration();
  const runtime = input.runtime();
  const validation = { observation: input.getObservationVersion?.() ?? 0, runtime: cloudSyncRuntimeToken(runtime), activity: input.activityToken?.() ?? "" };
  const stable = () => scope === input.getScope() && captured === input.getGeneration() && validation.observation === (input.getObservationVersion?.() ?? 0) && validation.runtime === cloudSyncRuntimeToken(input.runtime()) && validation.activity === (input.activityToken?.() ?? "");
  const result = (state: CloudSyncVerdictState, reason: string): CloudSyncVerdict => ({ state, reason, scope, validation, generation: captured, verifiedAt: state === "SYNCED" ? runtime.lastPushCompletedAt : null, bootstrapAt: runtime.scope === scope ? runtime.lastCompletedAt : null });
  if (input.authKnown?.() === false) return result("UNVERIFIABLE", "Session en cours de vérification");
  if (!scope?.startsWith("USER:")) return result("LOCAL_ONLY", "Aucun compte synchronisable actif");
  try {
    const e = await input.read(scope as `USER:${string}`);
    if (!stable()) return result("UNVERIFIABLE", "Les sources ont changé pendant la vérification");
    const scopedRuntime = runtime.scope === scope;
    if (e.issues.some(isCloudSyncConflictIssue) || e.mutations.some(isCloudSyncConflictMutation)) return result("CONFLICT", "Conflit durable non résolu");
    if ((scopedRuntime && (runtime.bootstrapInProgress || runtime.pushInProgress)) || e.traceActive || e.recoveryActive) return result("SYNCING", "Transfert ou préparation actif");
    if (e.issues.length || (scopedRuntime && (runtime.lastError || runtime.lastPushState === "STOPPED_ERROR")) || e.tracks.some(j => j.status === "FAILED") || e.mutations.some(m => m.lastErrorCode)) return result("ERROR", "Échec ou diagnostic durable non résolu");
    if (e.mutations.some(m => !(AUTOMATIC_SYNC_ENTITY_TYPES as readonly string[]).includes(m.entityType))) return result("UNVERIFIABLE", "Type non transporté présent dans l’outbox (flight-completion compris)");
    if (e.mutations.length || e.intents || e.tracks.length || (scopedRuntime && runtime.lastPushState === "PENDING")) return result(input.online() ? "PENDING" : "OFFLINE_PENDING", "Travail durable restant");
    if (!e.traceDiscoveryComplete) return result("UNVERIFIABLE", e.traceDiscoveryError ? "Découverte des traces impossible — couverture non vérifiable" : "Découverte des traces incomplète ou non vérifiée");
    if (!scopedRuntime) return result("UNVERIFIABLE", "Le runtime Cloud du compte courant n’est pas actif");
    if (!input.online()) return result("UNVERIFIABLE", "Hors ligne — la vérification Cloud ne peut pas être terminée");
    if (!e.coverageComplete) return result("UNVERIFIABLE", "La couverture des données locales n’est pas encore vérifiée");
    if (runtime.lastBootstrapState !== "SUCCESS") return result("UNVERIFIABLE", "La vérification initiale Cloud doit être relancée");
    if (runtime.lastPushState !== "COMPLETED" || !runtime.lastPushCompletedAt) return result("UNVERIFIABLE", "Aucun passage PUSH complet n’a été vérifié");
    if (e.passGeneration !== captured) return result("UNVERIFIABLE", "Les preuves Cloud doivent être reconstruites pour la version locale courante");
    // A second bounded, read-only scan validates diagnostics/queue even without a local event.
    const finalEvidence = await input.read(scope as `USER:${string}`);
    if (!stable() || !input.online() || input.authKnown?.() === false || JSON.stringify(e) !== JSON.stringify(finalEvidence)) return result("UNVERIFIABLE", "Les sources ont changé pendant la validation finale");
    return result("SYNCED", "Modifications locales acquittées dans le périmètre Cloud Sync");
  } catch (error) { return result("UNVERIFIABLE", error instanceof Error && error.message === "LOCAL_SYNC_INSPECTION_TIMEOUT" ? "Vérification locale impossible : le stockage ne répond pas" : "Inspection locale impossible ou données invalides"); }
}

/** The acceptance step, never the inspector, owns the last verified date (memory only). */
export class CloudSyncVerdictAcceptance {
  private readonly dates = new Map<string, string>();
  lastVerifiedAt(scope: string | null): string | null { return scope ? this.dates.get(scope) ?? null : null; }
  accept(verdict: CloudSyncVerdict, current: Readonly<{ applicable: boolean; scope: string | null; generation: number; observation: number; runtime: string; activity: string; online: boolean }>): CloudSyncVerdict | null {
    if (!current.applicable || verdict.scope !== current.scope || verdict.generation !== current.generation || !verdict.validation
      || verdict.validation.observation !== current.observation || verdict.validation.runtime !== current.runtime || verdict.validation.activity !== current.activity) return null;
    if (verdict.state === "SYNCED") {
      if (!current.online || !verdict.verifiedAt || !verdict.scope) return null;
      const previous = this.dates.get(verdict.scope);
      if (!previous || Date.parse(verdict.verifiedAt) > Date.parse(previous)) this.dates.set(verdict.scope, verdict.verifiedAt);
    }
    return { ...verdict, verifiedAt: this.lastVerifiedAt(verdict.scope) };
  }
}

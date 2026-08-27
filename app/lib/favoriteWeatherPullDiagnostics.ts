import type { CloudPullCursor } from "./cloudPullState.ts";

type MinimalFavorite = Readonly<{ id: string; name: string }>;

type PullPlan = Readonly<{
  at: string;
  inputCursor: CloudPullCursor | null;
  effectiveCursor: CloudPullCursor | null;
  localFavoriteCount: number;
  snapshotReplayExecuted: boolean;
  snapshotReplayReason: string;
}>;

type UiHydration = Readonly<{
  at: string;
  scope: string | null;
  favoriteCount: number;
  favorites: readonly MinimalFavorite[];
  selectedFavoriteId: string | null;
}>;

let lastPullPlan: PullPlan | null = null;
let lastPullPlans: PullPlan[] = [];
let lastPullResult: unknown = null;
let lastUiHydration: UiHydration | null = null;

export function beginFavoriteWeatherPullDiagnostic(): void {
  lastPullPlan = null;
  lastPullPlans = [];
  lastPullResult = null;
}

export function recordFavoriteWeatherPullPlan(input: Readonly<{
  inputCursor: CloudPullCursor | null;
  effectiveCursor: CloudPullCursor | null;
  localFavoriteCount: number;
}>): void {
  const snapshotReplayExecuted = input.inputCursor !== null && input.effectiveCursor === null;
  lastPullPlan = {
    at: new Date().toISOString(),
    ...input,
    snapshotReplayExecuted,
    snapshotReplayReason: snapshotReplayExecuted
      ? "LOCAL_COLLECTION_EMPTY_CURSOR_RESET"
      : input.inputCursor === null
        ? "INITIAL_FULL_SNAPSHOT"
        : "LOCAL_COLLECTION_NOT_EMPTY_CURSOR_PRESERVED",
  };
  lastPullPlans.push(lastPullPlan);
}

export function recordFavoriteWeatherPullResult(result: unknown): void {
  lastPullResult = result;
}

export function recordFavoriteWeatherUiHydration(input: Readonly<{
  scope: string | null;
  favorites: readonly MinimalFavorite[];
  selectedFavoriteId: string | null;
}>): void {
  lastUiHydration = {
    at: new Date().toISOString(),
    scope: input.scope,
    favoriteCount: input.favorites.length,
    favorites: input.favorites.map(({ id, name }) => ({ id, name })),
    selectedFavoriteId: input.selectedFavoriteId,
  };
}

export function inspectFavoriteWeatherPullDiagnostics() {
  return {
    lastPullPlan,
    lastPullPlans: lastPullPlans.map((plan) => ({ ...plan })),
    lastPullResult,
    lastUiHydration,
  } as const;
}

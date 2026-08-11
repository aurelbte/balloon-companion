"use client";
import { useEffect, useMemo, useState } from "react";
import { BALLOON_REGISTRY_EVENT, BALLOON_REGISTRY_VERSION, getActiveBalloon, loadBalloonRegistry, type BalloonRegistry } from "../lib/balloonStorage";
import { DATA_SCOPE_CHANGED_EVENT } from "../lib/auth/dataScopeRuntime";
export function useBalloonRegistryState(): Readonly<{ registry: BalloonRegistry; hydrated: boolean }> { const [state, setState] = useState<Readonly<{ registry: BalloonRegistry; hydrated: boolean }>>(() => ({ registry: { version: BALLOON_REGISTRY_VERSION, balloons: [], activeBalloonId: null }, hydrated: false })); useEffect(() => { const refresh = () => setState({ registry: loadBalloonRegistry(), hydrated: true }); const timer = window.setTimeout(refresh, 0); window.addEventListener("storage", refresh); window.addEventListener(BALLOON_REGISTRY_EVENT, refresh); window.addEventListener(DATA_SCOPE_CHANGED_EVENT, refresh); return () => { window.clearTimeout(timer); window.removeEventListener("storage", refresh); window.removeEventListener(BALLOON_REGISTRY_EVENT, refresh); window.removeEventListener(DATA_SCOPE_CHANGED_EVENT, refresh); }; }, []); return state; }
export function useBalloonRegistry(): BalloonRegistry { return useBalloonRegistryState().registry; }
export function useBalloons() { return useBalloonRegistry().balloons; }
export function useActiveBalloon() { const registry = useBalloonRegistry(); return useMemo(() => getActiveBalloon(registry), [registry]); }

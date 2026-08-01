"use client";
import { useEffect, useMemo, useState } from "react";
import { BALLOON_REGISTRY_EVENT, createDefaultBalloonRegistry, getActiveBalloon, loadBalloonRegistry, type BalloonRegistry } from "../lib/balloonStorage";
export function useBalloonRegistry(): BalloonRegistry { const [registry, setRegistry] = useState(createDefaultBalloonRegistry); useEffect(() => { const refresh = () => setRegistry(loadBalloonRegistry()); const timer = window.setTimeout(refresh, 0); window.addEventListener("storage", refresh); window.addEventListener(BALLOON_REGISTRY_EVENT, refresh); return () => { window.clearTimeout(timer); window.removeEventListener("storage", refresh); window.removeEventListener(BALLOON_REGISTRY_EVENT, refresh); }; }, []); return registry; }
export function useBalloons() { return useBalloonRegistry().balloons; }
export function useActiveBalloon() { const registry = useBalloonRegistry(); return useMemo(() => getActiveBalloon(registry), [registry]); }

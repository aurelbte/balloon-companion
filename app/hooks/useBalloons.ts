"use client";
import { useEffect, useState } from "react";
import { loadBalloons } from "../lib/balloonStorage";
import { REGISTERED_BALLOONS, type Balloon } from "../lib/balloons";
export function useBalloons(): readonly Balloon[] { const [balloons, setBalloons] = useState<readonly Balloon[]>(REGISTERED_BALLOONS); useEffect(() => { const refresh = () => setBalloons(loadBalloons()); const timer = window.setTimeout(refresh, 0); window.addEventListener("storage", refresh); window.addEventListener("balloon-companion:balloons-changed", refresh); return () => { window.clearTimeout(timer); window.removeEventListener("storage", refresh); window.removeEventListener("balloon-companion:balloons-changed", refresh); }; }, []); return balloons; }

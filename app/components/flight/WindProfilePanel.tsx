"use client";

import { X } from "lucide-react";
import {
  FLIGHT_WIND_ALTITUDE_LEVELS,
  type ObservedWind,
  type FlightWindLevel,
} from "../../lib/flightWindProfile";
import { useUnitPreferences } from "../../contexts/UnitPreferencesContext";
import { formatFlightAltitude, formatFlightSpeed, formatWeatherWind, knotsToKmh } from "../../lib/unitPreferences";

interface WindProfilePanelProps {
  open: boolean;
  observed: ReadonlyMap<FlightWindLevel, ObservedWind>;
  predicted: ReadonlyMap<FlightWindLevel, ObservedWind>;
  predictedModelLabel: string | null;
  onToggle: () => void;
  onClose: () => void;
}

export default function WindProfilePanel({ open, observed, predicted, predictedModelLabel, onToggle, onClose }: WindProfilePanelProps) {
  const units = useUnitPreferences();
  const formatPredictedWind = (value: ObservedWind | undefined) => value ? `${String(Math.round(value.directionDeg) % 360).padStart(3, "0")}° / ${formatWeatherWind(knotsToKmh(value.speedKt), units.weather.windSpeedUnit)}` : "—";
  const formatObserved = (value: ObservedWind | undefined) => value ? `${String(Math.round(value.directionDeg) % 360).padStart(3, "0")}° / ${formatFlightSpeed(knotsToKmh(value.speedKt), units.flightInstruments.speedUnit)}` : "—";
  return <div style={{ position: "fixed", left: 0, top: "max(150px, 24vh)", zIndex: 35, display: "flex", alignItems: "flex-start" }}>
    <button type="button" aria-expanded={open} aria-controls="flight-wind-profile" onClick={onToggle} style={{ minWidth: "44px", minHeight: "88px", padding: "12px 9px", border: "1px solid var(--bc-color-border-glass)", borderLeft: 0, borderRadius: "0 var(--bc-radius-control) var(--bc-radius-control) 0", background: "rgba(7, 17, 31, 0.88)", color: "var(--bc-color-text-secondary)", fontSize: "10px", fontWeight: 850, letterSpacing: ".12em", writingMode: "vertical-rl", boxShadow: "var(--bc-shadow-floating)", backdropFilter: "blur(18px)" }}>VENTS</button>
    {open && <aside id="flight-wind-profile" aria-label="Profil vertical des vents" className="bc-surface--floating" style={{ width: "min(310px, calc(100vw - 56px))", maxHeight: "min(62vh, 520px)", overflowY: "auto", marginLeft: "6px", padding: "var(--bc-space-3)", border: "1px solid var(--bc-color-border-glass)", borderRadius: "var(--bc-radius-dock)", color: "var(--bc-color-text)", boxShadow: "var(--bc-shadow-floating)", backdropFilter: "blur(20px)" }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "var(--bc-space-2)", paddingBottom: "var(--bc-space-2)", borderBottom: "1px solid var(--bc-color-border-glass)" }}><strong style={{ fontSize: "13px", letterSpacing: "-.01em" }}>Profil des vents</strong><button type="button" aria-label="Fermer le profil des vents" onClick={onClose} style={{ width: "40px", height: "40px", display: "grid", placeItems: "center", border: 0, borderRadius: "var(--bc-radius-control)", background: "transparent", color: "inherit" }}><X size={18} /></button></header>
      <div style={{ display: "grid", gridTemplateColumns: "56px 1fr 1fr", gap: "8px", alignItems: "center", fontSize: "11px", fontVariantNumeric: "tabular-nums" }}>
        <span /><strong style={{ color: "var(--bc-color-text-secondary)", fontSize: "9px", letterSpacing: ".06em", textTransform: "uppercase" }}>Observé</strong><strong style={{ color: "var(--bc-color-text-secondary)", fontSize: "9px", letterSpacing: ".06em", textTransform: "uppercase" }}>Prévu · {predictedModelLabel ?? "—"}</strong>
        {FLIGHT_WIND_ALTITUDE_LEVELS.map((level) => <div key={level} style={{ display: "contents" }}><strong style={{ color: "var(--bc-color-text-secondary)" }}>{level === 0 ? "Sol" : formatFlightAltitude(level, units.flightInstruments.altitudeUnit)}</strong><span>{formatObserved(observed.get(level))}</span><span>{formatPredictedWind(predicted.get(level))}</span></div>)}
      </div>
    </aside>}
  </div>;
}

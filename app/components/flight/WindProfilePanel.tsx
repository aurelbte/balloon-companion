"use client";

import { X } from "lucide-react";
import {
  FLIGHT_WIND_ALTITUDE_LEVELS,
  formatObservedWind,
  type ObservedWind,
  type FlightWindLevel,
} from "../../lib/flightWindProfile";

interface WindProfilePanelProps {
  open: boolean;
  observed: ReadonlyMap<FlightWindLevel, ObservedWind>;
  onToggle: () => void;
  onClose: () => void;
}

export default function WindProfilePanel({ open, observed, onToggle, onClose }: WindProfilePanelProps) {
  return <div style={{ position: "fixed", left: 0, top: "max(150px, 24vh)", zIndex: 35, display: "flex", alignItems: "flex-start" }}>
    <button type="button" aria-expanded={open} aria-controls="flight-wind-profile" onClick={onToggle} style={{ minWidth: "42px", minHeight: "88px", padding: "12px 8px", border: "1px solid var(--bc-color-border-glass)", borderLeft: 0, borderRadius: "0 12px 12px 0", background: "rgba(7,17,31,.92)", color: "var(--bc-color-text)", fontSize: "10px", fontWeight: 900, letterSpacing: ".12em", writingMode: "vertical-rl", backdropFilter: "blur(18px)" }}>VENTS</button>
    {open && <aside id="flight-wind-profile" aria-label="Profil vertical des vents" style={{ width: "min(310px, calc(100vw - 54px))", maxHeight: "min(62vh, 520px)", overflowY: "auto", marginLeft: "6px", padding: "12px", border: "1px solid var(--bc-color-border-glass)", borderRadius: "14px", background: "rgba(7,17,31,.95)", color: "var(--bc-color-text)", boxShadow: "var(--bc-shadow-floating)", backdropFilter: "blur(20px)" }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}><strong style={{ fontSize: "13px" }}>Profil des vents</strong><button type="button" aria-label="Fermer le profil des vents" onClick={onClose} style={{ width: "36px", height: "36px", display: "grid", placeItems: "center", border: 0, background: "transparent", color: "inherit" }}><X size={18} /></button></header>
      <div style={{ display: "grid", gridTemplateColumns: "54px 1fr 1fr", gap: "7px 8px", alignItems: "center", fontSize: "11px" }}>
        <span /><strong style={{ color: "var(--bc-color-text-secondary)", fontSize: "9px", textTransform: "uppercase" }}>Observé</strong><strong style={{ color: "var(--bc-color-text-secondary)", fontSize: "9px", textTransform: "uppercase" }}>Prévu</strong>
        {FLIGHT_WIND_ALTITUDE_LEVELS.map((level) => <div key={level} style={{ display: "contents" }}><strong>{level === 0 ? "Sol" : `${level} m`}</strong><span>{formatObservedWind(observed.get(level))}</span><span>—</span></div>)}
      </div>
    </aside>}
  </div>;
}

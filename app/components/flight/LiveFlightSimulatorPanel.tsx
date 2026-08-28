"use client";

import { useEffect, useRef, useState } from "react";
import { SharedPilotMapStore, type SharedPilotIdentity, type SharedPilotMapEntry } from "../../lib/liveFlightMap.ts";
import { createTargetedLiveFlightSimulator, isTargetedLiveFlightSimulator, type LiveSimulationScenario } from "../../lib/liveFlightSimulator.ts";

const CHARLES: SharedPilotIdentity = {
  pilotId: "dev-charles-grelin",
  displayName: "Charles Grelin",
  sessionId: "e217c050-10d2-4a59-8f7e-d076b9839a10",
};
const JEAN: SharedPilotIdentity = {
  pilotId: "dev-jean-dupont",
  displayName: "Jean Dupont",
  sessionId: "528664a5-c14c-41f1-9166-84649342329e",
};

const SCENARIOS: ReadonlyArray<Readonly<{ value: LiveSimulationScenario; label: string }>> = [
  { value: "NORMAL_FLIGHT", label: "Vol normal" },
  { value: "PROGRESSIVE_CLIMB", label: "Montée" },
  { value: "PROGRESSIVE_DESCENT", label: "Descente" },
  { value: "DIRECTION_CHANGE", label: "Changement de cap" },
  { value: "FROZEN_20_SECONDS", label: "Position figée" },
  { value: "SIMULATED_CRASH", label: "Fresh → stale → expiré" },
  { value: "NETWORK_LOSS_OVER_30_SECONDS", label: "Perte réseau" },
  { value: "RECONNECTION", label: "Reconnexion" },
  { value: "NORMAL_END", label: "Fin de partage" },
];

export default function LiveFlightSimulatorPanel({
  scopeKey,
  onPilotsChange,
}: Readonly<{ scopeKey: string | null; onPilotsChange: (pilots: SharedPilotMapEntry[]) => void }>) {
  const storeRef = useRef(new SharedPilotMapStore());
  const timersRef = useRef<number[]>([]);
  const [scenario, setScenario] = useState<LiveSimulationScenario>("NORMAL_FLIGHT");
  const [enabled, setEnabled] = useState(false);

  const clear = () => {
    for (const timer of timersRef.current) window.clearTimeout(timer);
    timersRef.current = [];
    storeRef.current.clearForUserSwitch();
    onPilotsChange([]);
  };

  useEffect(() => {
    clear();
    return clear;
    // Le changement de scope doit vider immédiatement les positions distantes en mémoire.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setEnabled(isTargetedLiveFlightSimulator(window.location.search));
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  if (!enabled) return null;

  const play = (identity: SharedPilotIdentity, selectedScenario: LiveSimulationScenario, coordinateOffset = 0) => {
    const simulator = createTargetedLiveFlightSimulator(window.location.search);
    const startedAt = Date.now();
    const events = simulator.run(selectedScenario, identity.sessionId, startedAt);
    for (const event of events) {
      timersRef.current.push(window.setTimeout(() => {
        if (event.kind === "POSITION") {
          const payload = event.payload && typeof event.payload === "object"
            ? { ...event.payload, latitude: Number((event.payload as { latitude?: unknown }).latitude) + coordinateOffset }
            : event.payload;
          storeRef.current.accept(identity, payload, Date.now());
          onPilotsChange(storeRef.current.list(Date.now()));
        } else if (event.kind === "END") {
          storeRef.current.removeSession(identity.sessionId);
          onPilotsChange(storeRef.current.list(Date.now()));
        }
      }, Math.max(0, event.at - startedAt)));
    }
  };

  return (
    <div aria-label="Simulateur de partage live" style={{ position: "fixed", right: 12, top: "max(154px, calc(env(safe-area-inset-top) + 138px))", zIndex: 25, display: "grid", gap: 6, width: 174, padding: 8, border: "1px solid rgba(253,230,138,.35)", borderRadius: 12, background: "rgba(7,17,31,.92)", color: "#f3f7fb", fontSize: 10 }}>
      <strong style={{ color: "#fde68a", letterSpacing: ".08em" }}>LIVE TEST CIBLÉ</strong>
      <select aria-label="Scénario live" value={scenario} onChange={(event) => setScenario(event.target.value as LiveSimulationScenario)} style={{ minHeight: 32, borderRadius: 7, background: "#102238", color: "#f3f7fb" }}>
        {SCENARIOS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
      </select>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5 }}>
        <button type="button" onClick={() => { clear(); play(CHARLES, scenario); }}>Charles Grelin (CG)</button>
        <button type="button" onClick={() => { clear(); play(CHARLES, scenario); play(JEAN, scenario, 0.0012); }}>Charles + Jean</button>
      </div>
      <button type="button" onClick={clear}>Arrêter</button>
    </div>
  );
}

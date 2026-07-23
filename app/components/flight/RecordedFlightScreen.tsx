"use client";

import { useRouter } from "next/navigation";
import type { RecordedFlight } from "../../lib/recordedFlight";
import { getFlightReplayPath } from "../../lib/recordedFlightPresentation";
import RecordedFlightSummaryCard from "./RecordedFlightSummaryCard";

export default function RecordedFlightScreen({
  flight,
  onReturn,
}: {
  flight: RecordedFlight;
  onReturn: () => void;
}) {
  const router = useRouter();
  const replayPath = getFlightReplayPath(flight.id);
  const openReplay = () => {
    if (!flight.id) return;
    if (process.env.NODE_ENV === "development") {
      console.debug(`[flight-replay] opening ${flight.id}`);
    }
    router.push(replayPath);
  };
  const actionStyle = {
    display: "grid",
    placeItems: "center",
    minHeight: "54px",
    borderRadius: "14px",
    fontWeight: 900,
    textDecoration: "none",
  };
  return (
    <main
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 90,
        overflowY: "auto",
        padding:
          "max(22px, env(safe-area-inset-top)) 16px max(22px, env(safe-area-inset-bottom))",
        background: "var(--bc-background)",
      }}
    >
      <div style={{ width: "min(100%, 430px)", margin: "0 auto" }}>
        <p
          style={{
            color: "var(--bc-success)",
            fontSize: "12px",
            fontWeight: 900,
            letterSpacing: ".12em",
          }}
        >
          VOL ENREGISTRÉ
        </p>
        <h1 style={{ margin: "8px 0 20px", fontSize: "30px", fontWeight: 950 }}>
          Enregistrement terminé
        </h1>
        <RecordedFlightSummaryCard flight={flight} />
        <div style={{ display: "grid", gap: "10px", marginTop: "18px" }}>
          <button
            type="button"
            disabled={!flight.id}
            onClick={openReplay}
            style={{
              ...actionStyle,
              border: 0,
              background: "var(--bc-accent)",
              color: "var(--bc-accent-foreground)",
            }}
          >
            VOIR LA TRACE
          </button>
          <button
            type="button"
            onClick={onReturn}
            style={{
              ...actionStyle,
              border: "1px solid var(--bc-border)",
              background: "var(--bc-surface)",
              color: "var(--bc-text-primary)",
            }}
          >
            RETOUR AU MODE VOL
          </button>
        </div>
      </div>
    </main>
  );
}

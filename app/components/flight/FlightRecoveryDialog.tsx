"use client";

import type { RecordedFlight } from "../../lib/recordedFlight";

interface FlightRecoveryDialogProps {
  flight: RecordedFlight;
  busy: boolean;
  onResume: () => void;
  onComplete: () => void;
  onAbandon: () => void;
}

export default function FlightRecoveryDialog({
  flight,
  busy,
  onResume,
  onComplete,
  onAbandon,
}: FlightRecoveryDialogProps) {
  const startTime = new Date(flight.startedAt).toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const buttonStyle = {
    minHeight: "50px",
    borderRadius: "13px",
    border: "1px solid var(--bc-border)",
    fontWeight: 850,
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="flight-recovery-title"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        display: "grid",
        placeItems: "center",
        padding: "20px",
        background: "rgba(2, 8, 18, 0.78)",
      }}
    >
      <section
        style={{
          width: "min(100%, 390px)",
          padding: "22px",
          borderRadius: "20px",
          background: "var(--bc-background-elevated)",
          border: "1px solid var(--bc-border-strong)",
          boxShadow: "0 22px 60px rgba(0,0,0,.48)",
        }}
      >
        <p
          style={{
            color: "var(--bc-warning)",
            fontSize: "12px",
            fontWeight: 900,
            letterSpacing: ".09em",
          }}
        >
          VOL INTERROMPU
        </p>
        <h2
          id="flight-recovery-title"
          style={{ marginTop: "8px", fontSize: "22px", fontWeight: 900 }}
        >
          Un enregistrement est en cours depuis {startTime}.
        </h2>
        <p
          style={{
            marginTop: "10px",
            color: "var(--bc-text-secondary)",
            fontSize: "14px",
          }}
        >
          {flight.points.length} points sont conservés sur cet appareil.
        </p>
        <div style={{ display: "grid", gap: "10px", marginTop: "20px" }}>
          <button
            disabled={busy}
            onClick={onResume}
            style={{
              ...buttonStyle,
              border: "none",
              background: "var(--bc-accent)",
              color: "var(--bc-accent-foreground)",
            }}
          >
            REPRENDRE
          </button>
          <button
            disabled={busy}
            onClick={onComplete}
            style={{
              ...buttonStyle,
              background: "var(--bc-surface)",
              color: "var(--bc-text-primary)",
            }}
          >
            TERMINER ET ENREGISTRER
          </button>
          <button
            disabled={busy}
            onClick={onAbandon}
            style={{
              ...buttonStyle,
              background: "transparent",
              color: "var(--bc-danger)",
            }}
          >
            ABANDONNER
          </button>
        </div>
      </section>
    </div>
  );
}

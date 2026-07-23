"use client";

import { useEffect, useRef } from "react";

interface ActiveFlightNavigationDialogProps {
  busy: boolean;
  onStay: () => void;
  onContinue: () => void;
  onFinalize: () => void;
}

export default function ActiveFlightNavigationDialog({
  busy,
  onStay,
  onContinue,
  onFinalize,
}: ActiveFlightNavigationDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const stayButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    stayButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onStay();
      if (event.key !== "Tab" || !dialogRef.current) return;
      const controls = [
        ...dialogRef.current.querySelectorAll<HTMLButtonElement>(
          "button:not(:disabled)",
        ),
      ];
      if (controls.length === 0) return;
      const first = controls[0];
      const last = controls.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [busy, onStay]);

  const buttonStyle = {
    minHeight: "52px",
    borderRadius: "13px",
    fontWeight: 900,
  };
  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="active-flight-navigation-title"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 110,
        display: "grid",
        placeItems: "center",
        padding: "20px",
        background: "rgba(2,8,18,.82)",
      }}
    >
      <section
        style={{
          width: "min(100%, 390px)",
          padding: "22px",
          borderRadius: "20px",
          background: "var(--bc-background-elevated)",
          border: "1px solid var(--bc-border-strong)",
        }}
      >
        <h2
          id="active-flight-navigation-title"
          style={{ fontSize: "24px", fontWeight: 950 }}
        >
          Vol en cours
        </h2>
        <p
          style={{
            marginTop: "12px",
            color: "var(--bc-text-secondary)",
            fontSize: "14px",
            lineHeight: 1.45,
          }}
        >
          L’enregistrement continuera pendant que Balloon Companion reste
          active. Sur iPhone, garder l’application au premier plan et l’écran
          allumé pour assurer le meilleur suivi possible.
        </p>
        <div style={{ display: "grid", gap: "10px", marginTop: "20px" }}>
          <button
            ref={stayButtonRef}
            type="button"
            disabled={busy}
            onClick={onStay}
            style={{
              ...buttonStyle,
              border: "1px solid var(--bc-border)",
              background: "var(--bc-surface)",
              color: "var(--bc-text-primary)",
            }}
          >
            RESTER SUR LE VOL
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onContinue}
            style={{
              ...buttonStyle,
              border: 0,
              background: "var(--bc-accent)",
              color: "var(--bc-accent-foreground)",
            }}
          >
            QUITTER ET CONTINUER
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onFinalize}
            style={{
              ...buttonStyle,
              border: "1px solid var(--bc-danger)",
              background: "transparent",
              color: "var(--bc-danger)",
            }}
          >
            ARRÊTER ET ENREGISTRER
          </button>
        </div>
      </section>
    </div>
  );
}

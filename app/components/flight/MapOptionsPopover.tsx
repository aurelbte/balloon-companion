"use client";

import { useEffect, useRef } from "react";
import { toggleMapLayerSetting } from "../../lib/flightMapPresentation";
import type { BaseMap, FlightLayerSettings } from "../../types/flight";

interface MapOptionsPopoverProps {
  isOpen: boolean;
  settings: FlightLayerSettings;
  baseMap: BaseMap;
  satelliteAvailable: boolean;
  satelliteMessage: string | null;
  airspacesLoading: boolean;
  airspacesError: string | null;
  onBaseMapChange: (baseMap: BaseMap) => void;
  onSettingsChange: (settings: FlightLayerSettings) => void;
  onClose: () => void;
}

const optionKeys = [
  ["airspaces", "Espaces aériens"],
  ["gpsProjection", "Projection GPS"],
  ["weatherProjection", "Projection météo"],
  ["highContrast", "Contraste élevé"],
] as const satisfies ReadonlyArray<
  readonly [keyof FlightLayerSettings, string]
>;

export default function MapOptionsPopover({
  isOpen,
  settings,
  baseMap,
  satelliteAvailable,
  satelliteMessage,
  airspacesLoading,
  airspacesError,
  onBaseMapChange,
  onSettingsChange,
  onClose,
}: MapOptionsPopoverProps) {
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    panelRef.current?.focus();
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const toggle = (key: keyof FlightLayerSettings) => {
    onSettingsChange(toggleMapLayerSetting(settings, key));
  };

  return (
    <>
      <button
        type="button"
        aria-label="Fermer les options de carte"
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 41,
          border: 0,
          padding: 0,
          background: "transparent",
          cursor: "default",
        }}
      />
      <section
        ref={panelRef}
        role="dialog"
        aria-label="Options de carte"
        tabIndex={-1}
        style={{
          position: "fixed",
          top: "max(72px, calc(env(safe-area-inset-top) + 54px))",
          right: "76px",
          zIndex: 42,
          width: "min(258px, calc(100vw - 92px))",
          maxHeight:
            "calc(100dvh - max(84px, env(safe-area-inset-top)) - 220px)",
          overflowY: "auto",
          border: "1px solid var(--bc-border-strong)",
          borderRadius: "15px",
          padding: "12px",
          background: "rgba(7, 17, 31, 0.96)",
          boxShadow: "0 12px 30px rgba(0, 0, 0, 0.4)",
          color: "var(--bc-text-primary)",
          backdropFilter: "blur(14px)",
          outline: "none",
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <h2
          style={{
            margin: "0 0 10px",
            fontSize: "15px",
            fontWeight: 900,
          }}
        >
          Carte
        </h2>

        <p style={sectionLabelStyle}>Fond</p>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "6px",
            marginBottom: "10px",
          }}
        >
          {(["plan", "satellite"] as const).map((option) => {
            const disabled = option === "satellite" && !satelliteAvailable;
            const selected = option === baseMap;
            return (
              <button
                key={option}
                type="button"
                disabled={disabled}
                aria-pressed={selected}
                onClick={() => onBaseMapChange(option)}
                style={{
                  minHeight: "42px",
                  borderRadius: "9px",
                  border: `1px solid ${
                    selected ? "var(--bc-accent)" : "var(--bc-border)"
                  }`,
                  background: selected
                    ? "rgba(245, 158, 66, 0.16)"
                    : "var(--bc-background-elevated)",
                  color: selected
                    ? "var(--bc-accent)"
                    : "var(--bc-text-primary)",
                  fontSize: "13px",
                  fontWeight: 800,
                  opacity: disabled ? 0.48 : 1,
                }}
              >
                {option === "plan" ? "Standard" : "Satellite"}
              </button>
            );
          })}
        </div>

        <p style={sectionLabelStyle}>Affichage</p>
        <div style={{ display: "grid", gap: "2px" }}>
          {optionKeys.map(([key, label]) => {
            const checked = settings[key];
            return (
              <button
                key={key}
                type="button"
                role="checkbox"
                aria-checked={checked}
                onClick={() => toggle(key)}
                style={{
                  display: "flex",
                  minHeight: "38px",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "10px",
                  border: 0,
                  borderRadius: "8px",
                  padding: "6px 8px",
                  background: checked
                    ? "rgba(245, 158, 66, 0.09)"
                    : "transparent",
                  color: "var(--bc-text-primary)",
                  fontSize: "13px",
                  fontWeight: 700,
                  textAlign: "left",
                }}
              >
                <span>{label}</span>
                <span
                  aria-hidden="true"
                  style={{
                    display: "grid",
                    width: "20px",
                    height: "20px",
                    flex: "0 0 20px",
                    placeItems: "center",
                    border: `1px solid ${
                      checked ? "var(--bc-accent)" : "var(--bc-border-strong)"
                    }`,
                    borderRadius: "6px",
                    background: checked ? "var(--bc-accent)" : "transparent",
                    color: "var(--bc-accent-foreground)",
                    fontSize: "14px",
                    fontWeight: 950,
                  }}
                >
                  {checked ? "✓" : ""}
                </span>
              </button>
            );
          })}
        </div>

        {(satelliteMessage ||
          (settings.airspaces && (airspacesLoading || airspacesError))) && (
          <p
            role="status"
            style={{
              margin: "8px 4px 0",
              color: "var(--bc-warning)",
              fontSize: "10px",
              fontWeight: 700,
              lineHeight: 1.3,
            }}
          >
            {satelliteMessage ??
              (airspacesLoading ? "Chargement…" : airspacesError)}
          </p>
        )}
        {settings.airspaces && !airspacesError && (
          <p
            style={{
              margin: "8px 4px 0",
              color: "var(--bc-text-muted)",
              fontSize: "9px",
              lineHeight: 1.25,
            }}
          >
            Données indicatives — vérifier AIP et NOTAM.
          </p>
        )}
      </section>
    </>
  );
}

const sectionLabelStyle = {
  margin: "0 0 5px",
  color: "var(--bc-text-muted)",
  fontSize: "9px",
  fontWeight: 850,
  letterSpacing: "0.09em",
  textTransform: "uppercase" as const,
};

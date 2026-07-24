"use client";

import { LocateFixed, Map, Maximize2, Play, Square } from "lucide-react";
import { FLIGHT_BOTTOM_LAYOUT } from "../../lib/flightMapPresentation";

interface FlightControlsProps {
  isTracking: boolean;
  followPosition: boolean;
  mapOptionsOpen: boolean;
  mapDisplayCustomized: boolean;
  withNavigation?: boolean;
  onRecenterMap: () => void;
  onFitProjection: () => void;
  onToggleMapOptions: () => void;
  onStartTracking: () => void;
  onStopTracking: () => void;
}

export default function FlightControls({
  isTracking,
  followPosition,
  mapOptionsOpen,
  mapDisplayCustomized,
  withNavigation = false,
  onRecenterMap,
  onFitProjection,
  onToggleMapOptions,
  onStartTracking,
  onStopTracking,
}: FlightControlsProps) {
  const buttonStyle = {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "48px",
    height: "48px",
    borderRadius: "50%",
    border: "none",
    backgroundColor: "var(--bc-accent)",
    color: "var(--bc-accent-foreground)",
    boxShadow: "0 4px 12px rgba(0, 0, 0, 0.3)",
    cursor: "pointer",
    transition: "all 0.2s ease",
    fontSize: "20px",
  };

  const secondaryButtonStyle = {
    ...buttonStyle,
    backgroundColor: "var(--bc-surface)",
    color: "var(--bc-text-primary)",
    border: "1px solid var(--bc-border)",
  };

  const primaryButtonStyle = {
    ...buttonStyle,
    width: isTracking ? "132px" : "118px",
    borderRadius: "24px",
    gap: "7px",
    fontSize: "11px",
    fontWeight: "900",
    letterSpacing: "0.04em",
  };

  const activeSecondaryButtonStyle = {
    ...secondaryButtonStyle,
    borderColor: "var(--bc-accent)",
    color: "var(--bc-accent)",
    backgroundColor: "rgba(7, 17, 31, 0.96)",
  };

  return (
    <div
      style={{
        position: "fixed",
        bottom: withNavigation
          ? `calc(max(16px, env(safe-area-inset-bottom)) + ${FLIGHT_BOTTOM_LAYOUT.controlsBottomOffset}px)`
          : "calc(max(6px, env(safe-area-inset-bottom)) + 124px)",
        right: "16px",
        display: "flex",
        flexDirection: "column" as const,
        gap: "12px",
        alignItems: "flex-end",
        zIndex: 44,
      }}
    >
      {/* Bouton recentrer */}
      <button
        type="button"
        onClick={onRecenterMap}
        style={
          followPosition ? activeSecondaryButtonStyle : secondaryButtonStyle
        }
        title="Suivre ma position"
        aria-label={
          followPosition
            ? "Suivi de position actif"
            : "Réactiver le suivi de position"
        }
        aria-pressed={followPosition}
      >
        <LocateFixed size={20} />
      </button>

      {/* Bouton cadrer projection */}
      <button
        type="button"
        onClick={onFitProjection}
        style={secondaryButtonStyle}
        title="Vue élargie de la trajectoire"
        aria-label="Afficher une vue élargie de la trajectoire projetée"
      >
        <Maximize2 size={20} />
      </button>

      {/* Options de carte */}
      <button
        type="button"
        onClick={onToggleMapOptions}
        style={
          mapOptionsOpen || mapDisplayCustomized
            ? activeSecondaryButtonStyle
            : secondaryButtonStyle
        }
        title="Carte"
        aria-label="Options de carte"
        aria-expanded={mapOptionsOpen}
        aria-pressed={mapDisplayCustomized}
      >
        <Map size={20} />
      </button>

      {/* Bouton principal : démarrer/arrêter le suivi */}
      {!isTracking ? (
        <button
          type="button"
          onClick={onStartTracking}
          style={primaryButtonStyle}
          title="Démarrer le suivi"
          aria-label="Démarrer l'enregistrement du vol"
        >
          <Play size={24} fill="currentColor" />
          DÉMARRER
        </button>
      ) : (
        <button
          type="button"
          onClick={onStopTracking}
          style={{
            ...primaryButtonStyle,
            backgroundColor: "#ef6464",
          }}
          title="Arrêter le suivi"
          aria-label="Arrêter l'enregistrement du vol"
        >
          <Square size={20} fill="currentColor" />
          ARRÊTER
        </button>
      )}
    </div>
  );
}

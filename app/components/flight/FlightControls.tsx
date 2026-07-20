"use client";

import { MapPin, Maximize2, Layers, Play, Square } from "lucide-react";

interface FlightControlsProps {
  isTracking: boolean;
  onRecenterMap: () => void;
  onFitProjection: () => void;
  onOpenLayers: () => void;
  onStartTracking: () => void;
  onStopTracking: () => void;
  onConfirmStop?: () => void;
}

export default function FlightControls({
  isTracking,
  onRecenterMap,
  onFitProjection,
  onOpenLayers,
  onStartTracking,
  onStopTracking,
  onConfirmStop,
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

  return (
    <div
      style={{
        position: "fixed",
        bottom: "120px",
        right: "16px",
        display: "flex",
        flexDirection: "column" as const,
        gap: "12px",
        zIndex: 40,
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      {/* Bouton recentrer */}
      <button
        onClick={onRecenterMap}
        style={secondaryButtonStyle}
        title="Recentrer la carte"
        aria-label="Recentrer la carte sur la position"
      >
        <MapPin size={20} />
      </button>

      {/* Bouton cadrer projection */}
      <button
        onClick={onFitProjection}
        style={secondaryButtonStyle}
        title="Cadrer la projection"
        aria-label="Adapter le zoom pour voir la projection"
      >
        <Maximize2 size={20} />
      </button>

      {/* Bouton couches */}
      <button
        onClick={onOpenLayers}
        style={secondaryButtonStyle}
        title="Couches"
        aria-label="Ouvrir le panneau des couches"
      >
        <Layers size={20} />
      </button>

      {/* Bouton principal : démarrer/arrêter le suivi */}
      {!isTracking ? (
        <button
          onClick={onStartTracking}
          style={buttonStyle}
          title="Démarrer le suivi"
          aria-label="Démarrer l'enregistrement du vol"
        >
          <Play size={24} fill="currentColor" />
        </button>
      ) : (
        <button
          onClick={() => {
            if (onConfirmStop) {
              const confirm = window.confirm(
                "Arrêter l'enregistrement du vol ?"
              );
              if (confirm) {
                onStopTracking();
              }
            } else {
              onStopTracking();
            }
          }}
          style={{
            ...buttonStyle,
            backgroundColor: "#ef6464",
          }}
          title="Arrêter le suivi"
          aria-label="Arrêter l'enregistrement du vol"
        >
          <Square size={20} fill="currentColor" />
        </button>
      )}
    </div>
  );
}

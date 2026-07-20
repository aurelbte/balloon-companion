"use client";

import { X } from "lucide-react";
import type { FlightLayerSettings } from "../../types/flight";

interface LayersPanelProps {
  settings: FlightLayerSettings;
  onSettingsChange: (settings: FlightLayerSettings) => void;
  onClose: () => void;
  isOpen: boolean;
}

export default function LayersPanel({
  settings,
  onSettingsChange,
  onClose,
  isOpen,
}: LayersPanelProps) {
  if (!isOpen) return null;

  const handleToggle = (key: keyof FlightLayerSettings) => {
    onSettingsChange({
      ...settings,
      [key]: !settings[key],
    });
  };

  const checkboxStyle = {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    padding: "12px 16px",
    borderBottom: "1px solid var(--bc-border)",
    cursor: "pointer",
    transition: "background 0.2s",
  };

  const labelStyle = {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    flex: 1,
    fontSize: "14px",
    fontWeight: "500",
  };

  const colorSquareStyle = (color: string) => ({
    width: "12px",
    height: "12px",
    borderRadius: "2px",
    backgroundColor: color,
  });

  return (
    <>
      {/* Overlay */}
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          backgroundColor: "rgba(0, 0, 0, 0.4)",
          zIndex: 30,
        }}
      />

      {/* Panneau */}
      <div
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          backgroundColor: "var(--bc-surface)",
          borderTop: "1px solid var(--bc-border)",
          zIndex: 50,
          maxHeight: "60vh",
          overflowY: "auto",
          borderRadius: "16px 16px 0 0",
          paddingTop: "12px",
        }}
      >
        {/* En-tête */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 16px",
            borderBottom: "1px solid var(--bc-border)",
            marginBottom: "8px",
          }}
        >
          <h2
            style={{
              fontSize: "16px",
              fontWeight: "700",
              color: "var(--bc-text-primary)",
              margin: 0,
            }}
          >
            Couches
          </h2>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: "var(--bc-text-muted)",
              cursor: "pointer",
              padding: "4px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            aria-label="Fermer le panneau"
          >
            <X size={20} />
          </button>
        </div>

        {/* Couches */}
        <div>
          {/* Projection GPS */}
          <label
            style={{
              ...checkboxStyle,
              backgroundColor: settings.gpsProjection
                ? "rgba(16, 185, 129, 0.1)"
                : "transparent",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = settings.gpsProjection
                ? "rgba(16, 185, 129, 0.15)"
                : "rgba(245, 158, 66, 0.05)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = settings.gpsProjection
                ? "rgba(16, 185, 129, 0.1)"
                : "transparent";
            }}
          >
            <input
              type="checkbox"
              checked={settings.gpsProjection}
              onChange={() => handleToggle("gpsProjection")}
              style={{
                width: "18px",
                height: "18px",
                cursor: "pointer",
              }}
            />
            <span style={labelStyle}>
              <span style={colorSquareStyle("#10b981")} />
              Projection GPS
            </span>
          </label>

          {/* Projection météo */}
          <label
            style={{
              ...checkboxStyle,
              backgroundColor: settings.weatherProjection
                ? "rgba(59, 130, 246, 0.1)"
                : "transparent",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = settings.weatherProjection
                ? "rgba(59, 130, 246, 0.15)"
                : "rgba(245, 158, 66, 0.05)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = settings.weatherProjection
                ? "rgba(59, 130, 246, 0.1)"
                : "transparent";
            }}
          >
            <input
              type="checkbox"
              checked={settings.weatherProjection}
              onChange={() => handleToggle("weatherProjection")}
              style={{
                width: "18px",
                height: "18px",
                cursor: "pointer",
              }}
            />
            <span style={labelStyle}>
              <span style={colorSquareStyle("#3b82f6")} />
              Projection météo
            </span>
          </label>

          {/* Contraste élevé */}
          <label
            style={{
              ...checkboxStyle,
              backgroundColor: settings.highContrast
                ? "rgba(245, 158, 66, 0.1)"
                : "transparent",
              borderBottom: "none",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = settings.highContrast
                ? "rgba(245, 158, 66, 0.15)"
                : "rgba(245, 158, 66, 0.05)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = settings.highContrast
                ? "rgba(245, 158, 66, 0.1)"
                : "transparent";
            }}
          >
            <input
              type="checkbox"
              checked={settings.highContrast}
              onChange={() => handleToggle("highContrast")}
              style={{
                width: "18px",
                height: "18px",
                cursor: "pointer",
              }}
            />
            <span style={labelStyle}>Contraste élevé</span>
          </label>
        </div>

        {/* Avertissement */}
        <div
          style={{
            padding: "12px 16px",
            marginTop: "12px",
            fontSize: "11px",
            color: "var(--bc-text-muted)",
            lineHeight: "1.4",
          }}
        >
          Prototype d&apos;essai — ne remplace pas les outils de navigation ni la décision du pilote.
        </div>
      </div>
    </>
  );
}

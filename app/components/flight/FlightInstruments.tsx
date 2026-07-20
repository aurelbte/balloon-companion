"use client";

import type { FlightMetrics } from "../../types/flight";
import {
  formatAltitude,
  formatDistance,
  formatDuration,
  formatGroundSpeed,
  formatHeading,
  formatVerticalSpeed,
} from "../../lib/geo";

interface FlightInstrumentsProps {
  metrics: FlightMetrics;
  isRecording: boolean;
  highContrast?: boolean;
  geolocationState?: string;
}

export default function FlightInstruments({
  metrics,
  isRecording,
  highContrast = false,
  geolocationState = "active",
}: FlightInstrumentsProps) {
  const getVarioIcon = (vario: number | null) => {
    if (vario === null || !isFinite(vario)) return "—";
    if (vario > 0.1) return "↑";
    if (vario < -0.1) return "↓";
    return "↔";
  };

  const panelStyle = {
    background: highContrast ? "rgba(7, 17, 31, 0.95)" : "rgba(7, 17, 31, 0.85)",
    borderTop: "1px solid var(--bc-border)",
    paddingBottom: "max(1rem, env(safe-area-inset-bottom))",
  };

  const instrumentStyle = {
    display: "grid",
    gridTemplateColumns: "repeat(4, 1fr)",
    gap: "0.5rem",
    marginBottom: "0.75rem",
  };

  const instrumentItemStyle = {
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    justifyContent: "center",
    gap: "0.25rem",
  };

  const labelStyle = {
    fontSize: "10px",
    fontWeight: "600",
    textTransform: "uppercase" as const,
    letterSpacing: "0.5px",
    color: highContrast ? "var(--bc-accent)" : "var(--bc-text-muted)",
  };

  const valueStyle = {
    fontSize: highContrast ? "18px" : "16px",
    fontWeight: "700",
    color: "var(--bc-text-primary)",
    lineHeight: "1.2",
  };

  const metricsStyle = {
    display: "grid",
    gridTemplateColumns: "repeat(2, 1fr)",
    gap: "0.5rem",
  };

  const metricRowStyle = {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "0.5rem 0",
    fontSize: "13px",
  };

  const recordingIndicatorStyle = isRecording
    ? {
        display: "inline-block",
        width: "8px",
        height: "8px",
        backgroundColor: "#ef6464",
        borderRadius: "50%",
        marginRight: "0.5rem",
        animation: "pulse 1s infinite",
      }
    : {};

  return (
    <div
      style={panelStyle}
      className="fixed bottom-0 left-0 right-0 px-4 pt-3"
    >
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>

      {/* Indicateur d'enregistrement et d'état GPS */}
      <div style={{ marginBottom: "0.75rem", fontSize: "11px", color: "var(--bc-text-muted)" }}>
        {isRecording && (
          <span style={{ display: "inline-flex", alignItems: "center" }}>
            <span style={recordingIndicatorStyle} />
            ENREGISTREMENT
            {geolocationState === "simulation" && " (SIMULATION)"}
          </span>
        )}
        {!isRecording && geolocationState === "simulation" && (
          <span style={{ color: "var(--bc-warning)" }}>MODE SIMULATION</span>
        )}
      </div>

      {/* Instruments principaux */}
      <div style={instrumentStyle}>
        {/* Altitude */}
        <div style={instrumentItemStyle}>
          <div style={labelStyle}>ALT</div>
          <div style={valueStyle}>{formatAltitude(metrics.altitude)}</div>
        </div>

        {/* Vario */}
        <div style={instrumentItemStyle}>
          <div style={labelStyle}>VARIO</div>
          <div style={{ ...valueStyle, display: "flex", alignItems: "center", gap: "4px" }}>
            <span>{getVarioIcon(metrics.verticalSpeed)}</span>
            <span>{formatVerticalSpeed(metrics.verticalSpeed)}</span>
          </div>
        </div>

        {/* Vitesse sol */}
        <div style={instrumentItemStyle}>
          <div style={labelStyle}>SOL</div>
          <div style={valueStyle}>{formatGroundSpeed(metrics.groundSpeed)}</div>
        </div>

        {/* Cap */}
        <div style={instrumentItemStyle}>
          <div style={labelStyle}>CAP</div>
          <div style={valueStyle}>{formatHeading(metrics.heading)}</div>
        </div>
      </div>

      {/* Métriques secondaires */}
      <div style={metricsStyle}>
        <div style={metricRowStyle}>
          <span style={{ color: "var(--bc-text-muted)" }}>VOL</span>
          <span style={{ fontWeight: "700", color: "var(--bc-text-primary)" }}>
            {formatDuration(metrics.durationSeconds)}
          </span>
        </div>

        <div style={metricRowStyle}>
          <span style={{ color: "var(--bc-text-muted)" }}>DIST</span>
          <span style={{ fontWeight: "700", color: "var(--bc-text-primary)" }}>
            {formatDistance(metrics.distanceKm)}
          </span>
        </div>
      </div>
    </div>
  );
}

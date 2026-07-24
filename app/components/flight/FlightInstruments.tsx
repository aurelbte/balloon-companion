"use client";

import type { FlightMetrics } from "../../types/flight";
import { formatDuration, normalizeHeading } from "../../lib/geo";
import { FLIGHT_BOTTOM_LAYOUT } from "../../lib/flightMapPresentation";

interface FlightInstrumentsProps {
  metrics: FlightMetrics;
  isRecording: boolean;
  highContrast?: boolean;
  geolocationState?: string;
  withNavigation?: boolean;
}

export default function FlightInstruments({
  metrics,
  highContrast = false,
  withNavigation = false,
}: FlightInstrumentsProps) {
  const formatAltitudeValue = (altitude: number | null) => {
    if (altitude === null || !Number.isFinite(altitude)) {
      return "—";
    }

    return Math.round(altitude).toString();
  };

  const panelBackground = highContrast
    ? "rgba(7, 17, 31, 0.97)"
    : "rgba(7, 17, 31, 0.88)";

  const altitudePanelStyle = {
    position: "fixed" as const,
    top: "max(16px, env(safe-area-inset-top))",
    left: "16px",
    zIndex: 20,
    minWidth: "146px",
    padding: "15px 17px",
    borderRadius: "16px",
    background: panelBackground,
    border: "1px solid rgba(255, 255, 255, 0.18)",
    backdropFilter: "blur(10px)",
    WebkitBackdropFilter: "blur(10px)",
    boxShadow: "0 5px 18px rgba(0, 0, 0, 0.3)",
    pointerEvents: "none" as const,
  };

  const bottomPanelStyle = {
    position: "fixed" as const,
    left: "6px",
    right: "6px",
    bottom: withNavigation
      ? `calc(max(16px, env(safe-area-inset-bottom)) + ${FLIGHT_BOTTOM_LAYOUT.instrumentsBottomOffset}px)`
      : "max(6px, env(safe-area-inset-bottom))",
    zIndex: 20,
    display: "grid",
    gridTemplateColumns: "0.9fr 1.35fr 1fr 0.85fr 1.15fr",
    alignItems: "stretch",
    minHeight: "112px",
    padding: "13px 7px 12px",
    borderRadius: "17px",
    background: panelBackground,
    border: "1px solid rgba(255, 255, 255, 0.18)",
    backdropFilter: "blur(10px)",
    WebkitBackdropFilter: "blur(10px)",
    boxShadow: "0 5px 18px rgba(0, 0, 0, 0.3)",
    pointerEvents: "none" as const,
  };

  const labelStyle = {
    fontSize: "10px",
    fontWeight: "800",
    lineHeight: "1",
    textTransform: "uppercase" as const,
    letterSpacing: "0.7px",
    color: highContrast
      ? "var(--bc-accent)"
      : "var(--bc-text-muted)",
  };
  const formatNumber = (value: number | null, decimals = 0) =>
    value === null || !Number.isFinite(value) ? "—" : value.toFixed(decimals);

  const headingValue =
    metrics.heading === null || !Number.isFinite(metrics.heading)
      ? "—"
      : Math.round(normalizeHeading(metrics.heading)).toString();
  const vario = metrics.verticalSpeed;
  const varioIsClimb = vario !== null && Number.isFinite(vario) && vario > 0.2;
  const varioIsDescent =
    vario !== null && Number.isFinite(vario) && vario < -0.2;
  const varioValue =
    vario === null || !Number.isFinite(vario)
      ? "—"
      : `${vario > 0 ? "+" : ""}${vario.toFixed(1)}${
          varioIsClimb ? " ↑" : varioIsDescent ? " ↓" : ""
        }`;
  const varioColor = varioIsClimb
    ? "var(--bc-success)"
    : varioIsDescent
      ? "var(--bc-danger)"
      : "var(--bc-text-primary)";

  const instruments = [
    { label: "CAP", value: headingValue, unit: "°", priority: "cap" },
    {
      label: "VARIO",
      value: varioValue,
      unit: "m/s",
      priority: "vario",
      color: varioColor,
    },
    {
      label: "SOL",
      value: formatNumber(
        metrics.groundSpeed === null ? null : metrics.groundSpeed * 3.6,
      ),
      unit: "km/h",
      priority: "speed",
    },
    {
      label: "DIST.",
      value: formatNumber(metrics.distanceKm, 1),
      unit: "km",
      priority: "distance",
    },
    {
      label: "VOL",
      value: formatDuration(metrics.durationSeconds),
      unit: "min:s",
      priority: "duration",
    },
  ];

  return (
    <>
      <style>{`
        .flight-instrument {
          min-width: 0;
          min-height: 86px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 0 7px;
          border-left: 1px solid rgba(255, 255, 255, 0.16);
        }
        .flight-instrument:first-child { border-left: 0; }
        .flight-instrument__value {
          margin-top: 8px;
          color: var(--bc-text-primary);
          font-size: clamp(23px, 6.8vw, 29px);
          font-weight: 900;
          font-variant-numeric: tabular-nums;
          letter-spacing: -0.04em;
          line-height: 0.95;
          white-space: nowrap;
        }
        .flight-instrument--vario .flight-instrument__value {
          font-size: clamp(26px, 7.4vw, 32px);
        }
        .flight-instrument--speed .flight-instrument__value {
          font-size: clamp(24px, 7vw, 30px);
        }
        .flight-instrument--duration .flight-instrument__value {
          font-size: clamp(22px, 6.4vw, 27px);
        }
        .flight-instrument--distance .flight-instrument__value {
          font-size: clamp(21px, 6vw, 25px);
        }
        .flight-instrument__unit {
          min-height: 12px;
          margin-top: 7px;
          color: var(--bc-text-secondary);
          font-size: 10px;
          font-weight: 750;
          line-height: 1;
          white-space: nowrap;
        }
        @media (max-width: 380px) {
          .flight-instrument { padding-inline: 4px; }
          .flight-instrument__label { font-size: 9px !important; letter-spacing: 0.45px !important; }
          .flight-instrument__value { margin-top: 7px; }
          .flight-instrument__unit { margin-top: 6px; font-size: 9px; }
        }
      `}</style>
      <section style={altitudePanelStyle} aria-label="Altitude actuelle">
        {[
          { label: "AMSL", value: formatAltitudeValue(metrics.altitude), unit: "m" },
          { label: "GND", value: "—", unit: "m" },
          { label: "QNH", value: "1013", unit: "hPa" },
        ].map((item, index) => (
          <div
            key={item.label}
            style={{
              paddingTop: index === 0 ? 0 : "10px",
              marginTop: index === 0 ? 0 : "10px",
              borderTop:
                index === 0 ? undefined : "1px solid rgba(255, 255, 255, 0.12)",
            }}
          >
            <div style={{ ...labelStyle, fontSize: "10px" }}>{item.label}</div>
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: "5px",
                marginTop: "4px",
              }}
            >
              <span
                style={{
                  fontSize: highContrast ? "28px" : "26px",
                  fontWeight: "850",
                  lineHeight: "1",
                  color: "var(--bc-text-primary)",
                }}
              >
                {item.value}
              </span>
              <span
                style={{
                  fontSize: "11px",
                  fontWeight: "700",
                  color: "var(--bc-text-muted)",
                }}
              >
                {item.unit}
              </span>
            </div>
          </div>
        ))}
      </section>

      <section
        style={bottomPanelStyle}
        aria-label="Instruments de vol"
      >
        {instruments.map((instrument) => (
          <div
            key={instrument.label}
            className={`flight-instrument flight-instrument--${instrument.priority}`}
          >
            <div className="flight-instrument__label" style={labelStyle}>
              {instrument.label}
            </div>
            <div
              className="flight-instrument__value"
              style={{ color: instrument.color }}
            >
              {instrument.value}
            </div>
            <div className="flight-instrument__unit">{instrument.unit}</div>
          </div>
        ))}
      </section>
    </>
  );
}

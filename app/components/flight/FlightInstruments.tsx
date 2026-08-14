"use client";

import { formatDuration, normalizeHeading } from "../../lib/geo";
import { FLIGHT_BOTTOM_LAYOUT } from "../../lib/flightMapPresentation";
import type { FlightSession } from "../../lib/flightCore";
import { useUnitPreferences } from "../../contexts/UnitPreferencesContext";
import { kilometresToNauticalMiles, kmhToKnots, metresToFeet } from "../../lib/unitPreferences";

interface FlightInstrumentsProps {
  session: FlightSession;
  highContrast?: boolean;
  geolocationState?: string;
  withNavigation?: boolean;
}

export default function FlightInstruments({
  session,
  highContrast = false,
  withNavigation = false,
}: FlightInstrumentsProps) {
  const units = useUnitPreferences();
  const metrics = session.statistics.metrics;
  const phase = session.phase;
  const formatAltitudeValue = (altitude: number | null) => {
    if (altitude === null || !Number.isFinite(altitude)) {
      return "—";
    }

    return Math.round(units.flightInstruments.altitudeUnit === "ft" ? metresToFeet(altitude) : altitude).toString();
  };

  const bottomOffset = withNavigation
    ? `calc(max(var(--bc-space-4), env(safe-area-inset-bottom)) + ${FLIGHT_BOTTOM_LAYOUT.instrumentsBottomOffset}px)`
    : "max(var(--bc-space-2), env(safe-area-inset-bottom))";
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
  const visualPhase =
    phase === "CLIMB"
      ? "climb"
      : phase === "DESCENT" || phase === "APPROACH"
        ? "descent"
        : phase === "CRUISE"
          ? "cruise"
          : "preflight";

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
        metrics.groundSpeed === null ? null : units.flightInstruments.speedUnit === "kt" ? kmhToKnots(metrics.groundSpeed * 3.6) : metrics.groundSpeed * 3.6,
      ),
      unit: units.flightInstruments.speedUnit,
      priority: "speed",
    },
    {
      label: "DIST.",
      value: formatNumber(metrics.distanceKm === null ? null : units.flightInstruments.distanceUnit === "NM" ? kilometresToNauticalMiles(metrics.distanceKm) : metrics.distanceKm, 1),
      unit: units.flightInstruments.distanceUnit,
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
        .flight-altimeter {
          position: fixed;
          top: max(var(--bc-space-4), env(safe-area-inset-top));
          left: var(--bc-space-4);
          z-index: var(--bc-z-floating);
          width: 168px;
          padding: var(--bc-space-3) var(--bc-space-4);
          pointer-events: none;
        }
        .flight-altimeter__primary {
          display: flex;
          align-items: baseline;
          gap: var(--bc-space-1);
          margin-top: var(--bc-space-1);
        }
        .flight-altimeter__value {
          color: var(--bc-color-text);
          font-size: 34px;
          font-weight: var(--bc-font-weight-bold);
          font-variant-numeric: tabular-nums;
          letter-spacing: -0.045em;
          line-height: 0.95;
          transition:
            font-size var(--bc-duration-normal) var(--bc-easing-standard),
            opacity var(--bc-duration-normal) var(--bc-easing-standard);
        }
        .flight-altimeter__unit,
        .flight-instrument__unit {
          color: var(--bc-color-text-secondary);
          font-size: var(--bc-font-size-label);
          font-weight: var(--bc-font-weight-semibold);
          line-height: 1;
        }
        .flight-altimeter__context {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: var(--bc-space-3);
          margin-top: var(--bc-space-3);
          padding-top: var(--bc-space-2);
          border-top: 1px solid var(--bc-color-border-glass);
        }
        .flight-altimeter__secondary {
          margin-top: var(--bc-space-1);
          color: var(--bc-color-text);
          font-size: 15px;
          font-weight: var(--bc-font-weight-bold);
          font-variant-numeric: tabular-nums;
          line-height: 1;
          white-space: nowrap;
        }
        .flight-cockpit-dock {
          position: fixed;
          left: var(--bc-space-2);
          right: var(--bc-space-2);
          z-index: var(--bc-z-floating);
          display: grid;
          grid-template-columns: 0.86fr 1.32fr 1fr 0.82fr 1.08fr;
          min-height: ${FLIGHT_BOTTOM_LAYOUT.instrumentsHeight}px;
          padding: var(--bc-space-3) var(--bc-space-1);
          pointer-events: none;
          transition: opacity var(--bc-duration-normal) var(--bc-easing-standard);
        }
        .flight-instrument {
          min-width: 0;
          min-height: 88px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding-inline: var(--bc-space-2);
          border-left: 1px solid var(--bc-color-border-glass);
          transition:
            opacity var(--bc-duration-normal) var(--bc-easing-standard),
            background-color var(--bc-duration-normal) var(--bc-easing-standard);
        }
        .flight-instrument:first-child { border-left: 0; }
        .flight-instrument__label,
        .flight-altimeter__label {
          color: ${highContrast ? "var(--bc-color-action)" : "var(--bc-color-text-muted)"};
          font-size: 10px;
          font-weight: var(--bc-font-weight-bold);
          line-height: 1;
          letter-spacing: var(--bc-letter-spacing-label);
          text-transform: uppercase;
        }
        .flight-instrument__value {
          margin-top: var(--bc-space-2);
          color: var(--bc-color-text);
          font-size: clamp(23px, 6.8vw, 29px);
          font-weight: var(--bc-font-weight-bold);
          font-variant-numeric: tabular-nums;
          letter-spacing: -0.04em;
          line-height: 0.95;
          white-space: nowrap;
          transition:
            font-size var(--bc-duration-normal) var(--bc-easing-standard),
            opacity var(--bc-duration-normal) var(--bc-easing-standard),
            color var(--bc-duration-normal) var(--bc-easing-standard);
        }
        .flight-instrument--vario {
          margin-block: calc(var(--bc-space-1) * -1);
          border-radius: var(--bc-radius-control);
          background: rgb(255 255 255 / 4%);
          box-shadow: inset 0 1px 0 var(--bc-color-surface-highlight);
        }
        .flight-instrument--vario .flight-instrument__value {
          font-size: clamp(28px, 7.8vw, 34px);
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
        .flight-cockpit-dock[data-flight-phase="preflight"] {
          opacity: 0.86;
        }
        .flight-cockpit-dock[data-flight-phase="climb"]
          .flight-instrument:not(.flight-instrument--vario) {
          opacity: 0.76;
        }
        .flight-cockpit-dock[data-flight-phase="climb"]
          .flight-instrument--vario .flight-instrument__value,
        .flight-cockpit-dock[data-flight-phase="descent"]
          .flight-instrument--vario .flight-instrument__value {
          font-size: clamp(30px, 8.2vw, 36px);
        }
        .flight-altimeter[data-flight-phase="climb"]
          .flight-altimeter__value,
        .flight-altimeter[data-flight-phase="descent"]
          .flight-altimeter__value {
          font-size: 38px;
        }
        .flight-cockpit-dock[data-flight-phase="cruise"]
          .flight-instrument--speed .flight-instrument__value {
          font-size: clamp(26px, 7.2vw, 31px);
        }
        .flight-cockpit-dock[data-flight-phase="descent"]
          .flight-instrument--cap,
        .flight-cockpit-dock[data-flight-phase="descent"]
          .flight-instrument--duration {
          opacity: 0.78;
        }
        .flight-cockpit-dock[data-flight-phase="descent"]
          .flight-instrument--distance .flight-instrument__value {
          font-size: clamp(23px, 6.4vw, 27px);
        }
        .flight-instrument__unit {
          min-height: 12px;
          margin-top: var(--bc-space-2);
          white-space: nowrap;
        }
        @media (max-width: 380px) {
          .flight-cockpit-dock {
            left: var(--bc-space-1);
            right: var(--bc-space-1);
          }
          .flight-instrument { padding-inline: var(--bc-space-1); }
          .flight-instrument__label { font-size: 9px !important; letter-spacing: 0.45px !important; }
          .flight-instrument__value { margin-top: var(--bc-space-2); }
          .flight-instrument__unit { margin-top: var(--bc-space-1); font-size: 9px; }
        }
      `}</style>
      <section
        className={`bc-floating-panel flight-altimeter ${
          highContrast ? "bc-surface--overlay" : "bc-surface--floating"
        }`}
        data-flight-phase={visualPhase}
        aria-label="Altitude actuelle"
      >
        <div className="flight-altimeter__label">AMSL</div>
        <div className="flight-altimeter__primary">
          <span className="flight-altimeter__value">
            {formatAltitudeValue(metrics.altitude)}
          </span>
          <span className="flight-altimeter__unit">{units.flightInstruments.altitudeUnit}</span>
        </div>
        <div className="flight-altimeter__context">
          <div>
            <div className="flight-altimeter__label">GND</div>
            <div className="flight-altimeter__secondary">— {units.flightInstruments.altitudeUnit}</div>
          </div>
          <div>
            <div className="flight-altimeter__label">QNH</div>
            <div className="flight-altimeter__secondary">
              {session.altitude.qnhHpa === null ? "—" : `${session.altitude.qnhHpa} hPa`}
            </div>
          </div>
        </div>
      </section>

      <section
        className={`bc-bottom-dock flight-cockpit-dock ${
          highContrast ? "bc-surface--overlay" : ""
        }`}
        style={{ bottom: bottomOffset }}
        data-flight-phase={visualPhase}
        aria-label="Instruments de vol"
      >
        {instruments.map((instrument) => (
          <div
            key={instrument.label}
            className={`flight-instrument flight-instrument--${instrument.priority}`}
          >
            <div className="flight-instrument__label">
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

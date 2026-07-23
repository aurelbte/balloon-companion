import type { RecordedFlight } from "../../lib/recordedFlight";
import { getRecordedFlightPresentation } from "../../lib/recordedFlightPresentation";

export default function RecordedFlightSummaryCard({
  flight,
}: {
  flight: RecordedFlight;
}) {
  const presentation = getRecordedFlightPresentation(flight);
  const rows = [
    ["Date", presentation.date],
    ["Départ", presentation.startTime],
    ["Fin", presentation.endTime],
    ["Durée", presentation.duration],
    ["Distance", presentation.distance],
    ["Altitude min.", presentation.minAltitude],
    ["Altitude max.", presentation.maxAltitude],
    ["Vitesse moyenne", presentation.averageGroundSpeed],
    ["Vitesse maximale", presentation.maxGroundSpeed],
    ["Points GPS", presentation.pointCount],
  ];
  return (
    <dl
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: "1px",
        overflow: "hidden",
        border: "1px solid var(--bc-border)",
        borderRadius: "16px",
        background: "var(--bc-border)",
      }}
    >
      {rows.map(([label, value]) => (
        <div
          key={label}
          style={{
            minHeight: "78px",
            padding: "13px",
            background: "var(--bc-surface)",
          }}
        >
          <dt
            style={{
              color: "var(--bc-text-muted)",
              fontSize: "10px",
              fontWeight: 800,
              textTransform: "uppercase",
              letterSpacing: ".06em",
            }}
          >
            {label}
          </dt>
          <dd
            style={{
              marginTop: "7px",
              color: "var(--bc-text-primary)",
              fontSize: "18px",
              fontWeight: 900,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

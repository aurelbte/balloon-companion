"use client";

import { ChevronLeft, ChevronRight, X } from "lucide-react";
import {
  normalizeOpenAipAltitudeLimit,
  type AirspaceVerticalContext,
} from "../../lib/airspaceAltitude";
import type {
  AirspaceGeoJsonProperties,
  OpenAipAltitudeLimit,
} from "../../lib/openaip";
import type { AirspaceFrequencyPresentation } from "../../lib/operationalFrequency";

interface AirspaceDetailsProps {
  airspace: AirspaceGeoJsonProperties;
  verticalContext: AirspaceVerticalContext;
  currentIndex: number;
  totalCount: number;
  onPrevious: () => void;
  onNext: () => void;
  onClose: () => void;
  contextLabel?: "ESPACE ACTUEL" | "ESPACE CONSULTÉ";
  frequencies: AirspaceFrequencyPresentation[];
}

function formatAltitudeLimit(limit: OpenAipAltitudeLimit | null): string {
  return normalizeOpenAipAltitudeLimit(limit).displayLabel;
}

function getUnavailableReason(
  airspace: AirspaceGeoJsonProperties,
  verticalContext: AirspaceVerticalContext
): string {
  if (verticalContext.currentAltitudeMeters === null) {
    return "Altitude GPS indisponible";
  }

  const limits = [
    normalizeOpenAipAltitudeLimit(airspace.lowerLimit),
    normalizeOpenAipAltitudeLimit(airspace.upperLimit),
  ];
  if (limits.some((limit) => limit.reference === "FL")) {
    return "Limite exprimée en niveau de vol";
  }
  if (limits.some((limit) => limit.reference === "AGL")) {
    return "Limite exprimée par rapport au sol";
  }
  return "Limites verticales non comparables";
}

export default function AirspaceDetails({
  airspace,
  verticalContext,
  currentIndex,
  totalCount,
  onPrevious,
  onNext,
  onClose,
  contextLabel = "ESPACE CONSULTÉ",
  frequencies,
}: AirspaceDetailsProps) {
  const hasMultipleAirspaces = totalCount > 1;

  return (
    <aside
      aria-label="Informations sur l’espace aérien"
      style={{
        position: "fixed",
        left: "12px",
        bottom: "calc(max(6px, env(safe-area-inset-bottom)) + 196px)",
        zIndex: 25,
        width: "min(330px, calc(100vw - 92px))",
        maxHeight: "42vh",
        overflowY: "auto",
        padding: "12px",
        borderRadius: "14px",
        border: "1px solid rgba(196, 181, 253, 0.55)",
        background: "rgba(7, 17, 31, 0.94)",
        boxShadow: "0 10px 28px rgba(0, 0, 0, 0.34)",
        color: "var(--bc-text-primary)",
        backdropFilter: "blur(10px)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: "8px",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <p
            style={{
              margin: "0 0 4px",
              color: "var(--bc-text-muted)",
              fontSize: "9px",
              fontWeight: 800,
              letterSpacing: "0.08em",
            }}
          >
            {contextLabel}
          </p>
          <h2
            style={{
              margin: 0,
              fontSize: "17px",
              lineHeight: 1.2,
              fontWeight: 800,
              overflowWrap: "anywhere",
            }}
          >
            {airspace.name}
          </h2>
          <p
            style={{
              margin: "5px 0 0",
              color: "#c4b5fd",
              fontSize: "13px",
              fontWeight: 750,
            }}
          >
            {airspace.typeLabel} · Classe {airspace.icaoClassLabel}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fermer la fiche"
          style={{
            flex: "0 0 auto",
            width: "36px",
            height: "36px",
            display: "grid",
            placeItems: "center",
            border: "none",
            borderRadius: "9px",
            background: "rgba(255, 255, 255, 0.09)",
            color: "inherit",
          }}
        >
          <X size={20} />
        </button>
      </div>

      <dl
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "10px 14px",
          margin: "12px 0 0",
        }}
      >
        <div>
          <dt style={{ color: "var(--bc-text-muted)", fontSize: "10px" }}>
            PLANCHER
          </dt>
          <dd style={{ margin: "2px 0 0", fontSize: "14px", fontWeight: 750 }}>
            {formatAltitudeLimit(airspace.lowerLimit)}
          </dd>
        </div>
        <div>
          <dt style={{ color: "var(--bc-text-muted)", fontSize: "10px" }}>
            PLAFOND
          </dt>
          <dd style={{ margin: "2px 0 0", fontSize: "14px", fontWeight: 750 }}>
            {formatAltitudeLimit(airspace.upperLimit)}
          </dd>
        </div>
        {frequencies.map((frequency, index) => (
          <div
            key={`${frequency.value}-${frequency.name ?? index}`}
            style={{
              gridColumn: "1 / -1",
              padding: frequency.isOperational ? "8px 9px" : 0,
              borderRadius: "9px",
              background: frequency.isOperational
                ? "rgba(96, 165, 250, 0.12)"
                : "transparent",
            }}
          >
            {frequency.name && (
              <dt
                style={{
                  color: frequency.isOperational
                    ? "#bfdbfe"
                    : "var(--bc-text-primary)",
                  fontSize: "13px",
                  fontWeight: 800,
                }}
              >
                {frequency.name}
              </dt>
            )}
            <dd
              style={{
                margin: frequency.name ? "2px 0 0" : 0,
                fontSize: "18px",
                lineHeight: 1,
                fontWeight: 850,
              }}
            >
              {frequency.value}
            </dd>
          </div>
        ))}
        <div style={{ gridColumn: "1 / -1" }}>
          <dt style={{ color: "var(--bc-text-muted)", fontSize: "10px" }}>
            PAYS
          </dt>
          <dd style={{ margin: "2px 0 0", fontSize: "13px" }}>
            {airspace.country ?? "—"}
          </dd>
        </div>
        {airspace.remarks && (
          <div style={{ gridColumn: "1 / -1" }}>
            <dt style={{ color: "var(--bc-text-muted)", fontSize: "10px" }}>
              REMARQUES
            </dt>
            <dd
              style={{
                margin: "2px 0 0",
                fontSize: "12px",
                lineHeight: 1.35,
                whiteSpace: "pre-wrap",
              }}
            >
              {airspace.remarks}
            </dd>
          </div>
        )}
      </dl>

      <div
        style={{
          marginTop: "12px",
          padding: "10px",
          borderRadius: "10px",
          background: "rgba(196, 181, 253, 0.09)",
          border: "1px solid rgba(196, 181, 253, 0.2)",
        }}
      >
        {verticalContext.state === "INSIDE" &&
        verticalContext.distanceToCeilingMeters !== null ? (
          <>
            <p style={verticalLabelStyle}>ÉCART JUSQU’AU PLAFOND</p>
            <p style={verticalValueStyle}>
              {Math.round(verticalContext.distanceToCeilingMeters)} m
            </p>
            <p style={verticalHintStyle}>Dans les limites verticales de la zone</p>
          </>
        ) : verticalContext.state === "BELOW" &&
          verticalContext.distanceToFloorMeters !== null ? (
          <>
            <p style={verticalLabelStyle}>POSITION VERTICALE</p>
            <p style={verticalValueStyle}>
              Sous le plancher de {Math.round(verticalContext.distanceToFloorMeters)} m
            </p>
          </>
        ) : verticalContext.state === "ABOVE" &&
          verticalContext.distanceToCeilingMeters !== null ? (
          <>
            <p style={verticalLabelStyle}>POSITION VERTICALE</p>
            <p style={verticalValueStyle}>
              Au-dessus du plafond de{" "}
              {Math.round(verticalContext.distanceToCeilingMeters)} m
            </p>
          </>
        ) : (
          <>
            <p style={verticalLabelStyle}>MARGE VERTICALE</p>
            <p style={verticalValueStyle}>Non calculable automatiquement</p>
            <p style={verticalHintStyle}>
              {getUnavailableReason(airspace, verticalContext)}
            </p>
          </>
        )}

        {verticalContext.currentAltitudeMeters !== null && (
          <p style={{ ...verticalHintStyle, marginTop: "7px" }}>
            Altitude GPS indicative :{" "}
            {Math.round(verticalContext.currentAltitudeMeters)} m
            {verticalContext.verticalAccuracyMeters !== null
              ? ` ± ${Math.round(verticalContext.verticalAccuracyMeters)} m`
              : ""}
          </p>
        )}
      </div>

      {hasMultipleAirspaces && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginTop: "12px",
            paddingTop: "10px",
            borderTop: "1px solid rgba(255, 255, 255, 0.12)",
          }}
        >
          <button
            type="button"
            onClick={onPrevious}
            aria-label="Espace aérien précédent"
            style={navigationButtonStyle}
          >
            <ChevronLeft size={20} />
          </button>
          <span style={{ fontSize: "12px", fontWeight: 750 }}>
            {currentIndex + 1} / {totalCount}
          </span>
          <button
            type="button"
            onClick={onNext}
            aria-label="Espace aérien suivant"
            style={navigationButtonStyle}
          >
            <ChevronRight size={20} />
          </button>
        </div>
      )}

      <p
        style={{
          margin: "10px 0 0",
          color: "var(--bc-text-muted)",
          fontSize: "10px",
          lineHeight: 1.3,
        }}
      >
        Données indicatives — vérifier l’AIP et les NOTAM officiels.
      </p>
    </aside>
  );
}

const navigationButtonStyle = {
  width: "38px",
  height: "38px",
  display: "grid",
  placeItems: "center",
  border: "1px solid rgba(255, 255, 255, 0.16)",
  borderRadius: "9px",
  background: "rgba(255, 255, 255, 0.08)",
  color: "inherit",
  cursor: "pointer",
};

const verticalLabelStyle = {
  margin: 0,
  color: "var(--bc-text-muted)",
  fontSize: "10px",
  fontWeight: 700,
};

const verticalValueStyle = {
  margin: "3px 0 0",
  fontSize: "14px",
  lineHeight: 1.25,
  fontWeight: 800,
};

const verticalHintStyle = {
  margin: "3px 0 0",
  color: "var(--bc-text-muted)",
  fontSize: "10px",
  lineHeight: 1.3,
};

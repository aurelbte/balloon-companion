"use client";

import { ChevronLeft, ChevronRight, X } from "lucide-react";
import {
  normalizeOpenAipAltitudeLimit,
} from "../../lib/airspaceAltitude";
import type {
  AirspaceGeoJsonProperties,
  OpenAipAltitudeLimit,
} from "../../lib/openaip";
import type { AirspaceFrequencyPresentation } from "../../lib/operationalFrequency";

interface AirspaceDetailsProps {
  airspace: AirspaceGeoJsonProperties;
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

export default function AirspaceDetails({
  airspace,
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
        padding: "var(--bc-space-3)",
        borderRadius: "var(--bc-radius-dock)",
        border: "1px solid rgba(196, 181, 253, 0.55)",
        background: "rgba(7, 17, 31, 0.94)",
        boxShadow: "var(--bc-shadow-floating)",
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
            width: "40px",
            height: "40px",
            display: "grid",
            placeItems: "center",
            border: "none",
            borderRadius: "var(--bc-radius-control)",
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

      {hasMultipleAirspaces && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginTop: "var(--bc-space-3)",
            paddingTop: "var(--bc-space-2)",
            borderTop: "1px solid var(--bc-color-border-glass)",
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
          <span style={{ color: "var(--bc-color-text-secondary)", fontSize: "12px", fontWeight: 750, fontVariantNumeric: "tabular-nums" }}>
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
  width: "40px",
  height: "40px",
  display: "grid",
  placeItems: "center",
  border: "1px solid rgba(255, 255, 255, 0.16)",
  borderRadius: "var(--bc-radius-control)",
  background: "rgba(255, 255, 255, 0.08)",
  color: "inherit",
  cursor: "pointer",
};

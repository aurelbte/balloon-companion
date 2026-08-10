import type { BcFlightExport } from "./bcFlightExport.ts";
import { diagnoseRecordedFlight, type GpsStatisticsDiagnostic } from "./gpsStatsDiagnostic.ts";
import type { RecordedFlight, RecordedFlightPoint, RecordedFlightSummary } from "./recordedFlight.ts";

export type BcFlightImportErrorCode =
  | "INVALID_JSON"
  | "INVALID_FORMAT"
  | "UNSUPPORTED_VERSION"
  | "MISSING_FLIGHT"
  | "MISSING_RECORDED_TRACE";

export class BcFlightImportError extends Error {
  readonly code: BcFlightImportErrorCode;

  constructor(code: BcFlightImportErrorCode, message: string) {
    super(message);
    this.name = "BcFlightImportError";
    this.code = code;
  }
}

export interface ImportedBcFlight {
  container: BcFlightExport;
  flight: RecordedFlight;
  diagnostic: GpsStatisticsDiagnostic;
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function requiredNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function parseBcFlight(text: string): ImportedBcFlight {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new BcFlightImportError("INVALID_JSON", "Le fichier ne contient pas un JSON valide.");
  }
  const container = objectValue(parsed);
  if (container?.format !== "BCFLIGHT") {
    throw new BcFlightImportError("INVALID_FORMAT", "Ce fichier n’est pas un export BCFLIGHT.");
  }
  if (container.formatVersion !== 1) {
    throw new BcFlightImportError("UNSUPPORTED_VERSION", "Cette version de BCFLIGHT n’est pas prise en charge.");
  }
  const flightValue = objectValue(container.flight);
  if (!flightValue || typeof flightValue.id !== "string") {
    throw new BcFlightImportError("MISSING_FLIGHT", "Les informations du vol sont absentes.");
  }
  const traceValue = objectValue(container.recordedTrace);
  if (!traceValue || !Array.isArray(traceValue.points)) {
    throw new BcFlightImportError("MISSING_RECORDED_TRACE", "La trace GPS est absente.");
  }
  const statistics = objectValue(container.statistics);
  const balloon = objectValue(container.balloon);
  const points = traceValue.points.map((point) => ({ ...objectValue(point) })) as unknown as RecordedFlightPoint[];
  const startedAt = requiredNumber(flightValue.startedAt, points[0]?.timestamp ?? 0);
  const endedAt = flightValue.endedAt === null ? null : requiredNumber(flightValue.endedAt, points.at(-1)?.timestamp ?? startedAt);
  const flight: RecordedFlight = {
    id: flightValue.id,
    schemaVersion: requiredNumber(traceValue.schemaVersion, 1),
    status: flightValue.status === "RECORDING" || flightValue.status === "INTERRUPTED" ? flightValue.status : "COMPLETED",
    startedAt,
    endedAt,
    points,
    summary: { ...(statistics ?? {}) } as unknown as RecordedFlightSummary,
    createdAt: requiredNumber(flightValue.createdAt, startedAt),
    updatedAt: requiredNumber(flightValue.updatedAt, endedAt ?? startedAt),
    ...(typeof balloon?.registration === "string" ? { balloonRegistration: balloon.registration } : {}),
    ...(typeof flightValue.startLocationLabel === "string" ? { startLocationLabel: flightValue.startLocationLabel } : {}),
    ...(typeof flightValue.endLocationLabel === "string" ? { endLocationLabel: flightValue.endLocationLabel } : {}),
    ...(typeof flightValue.generatedTitle === "string" ? { generatedTitle: flightValue.generatedTitle } : {}),
  };
  return {
    container: parsed as BcFlightExport,
    flight,
    diagnostic: diagnoseRecordedFlight(flight),
  };
}

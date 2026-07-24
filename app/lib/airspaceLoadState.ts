export type AirspaceErrorCategory =
  | "OFFLINE"
  | "TIMEOUT"
  | "HTTP_ERROR"
  | "PARSE_ERROR"
  | "ABORTED"
  | "UNKNOWN_ERROR";

export interface AirspaceFailure {
  category: AirspaceErrorCategory;
  httpStatus: number | null;
}

export class AirspaceHttpError extends Error {
  readonly status: number;
  readonly retryAfterMs: number | null;

  constructor(status: number, retryAfterMs: number | null = null) {
    super(`OpenAIP HTTP ${status}`);
    this.name = "AirspaceHttpError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

export class AirspaceTimeoutError extends Error {
  constructor() {
    super("OpenAIP request timed out");
    this.name = "AirspaceTimeoutError";
  }
}

export class AirspaceOfflineError extends Error {
  constructor() {
    super("Network is offline");
    this.name = "AirspaceOfflineError";
  }
}

export function classifyAirspaceError(
  error: unknown,
  online: boolean,
): AirspaceFailure {
  if (error instanceof AirspaceOfflineError || !online) {
    return { category: "OFFLINE", httpStatus: null };
  }
  if (error instanceof AirspaceTimeoutError) {
    return { category: "TIMEOUT", httpStatus: null };
  }
  if (error instanceof AirspaceHttpError) {
    return { category: "HTTP_ERROR", httpStatus: error.status };
  }
  if (error instanceof SyntaxError) {
    return { category: "PARSE_ERROR", httpStatus: null };
  }
  if (
    (typeof DOMException !== "undefined" && error instanceof DOMException
      ? error.name === "AbortError"
      : error instanceof Error && error.name === "AbortError")
  ) {
    return { category: "ABORTED", httpStatus: null };
  }
  return { category: "UNKNOWN_ERROR", httpStatus: null };
}

export type AirspaceUiState =
  | "IDLE"
  | "LOADING"
  | "READY"
  | "PARTIAL"
  | "CACHE"
  | "OFFLINE"
  | "ERROR"
  | "NO_DATA";

export interface AirspaceUiPresentation {
  state: AirspaceUiState;
  message: string | null;
}

export function getAirspaceUiPresentation({
  explorationEnabled,
  coverageStatus,
  failures,
  hasData,
  staleCacheUsed,
}: {
  explorationEnabled: boolean;
  coverageStatus: "COMPLETE" | "LOADING" | "PARTIAL" | "UNAVAILABLE";
  failures: AirspaceFailure[];
  hasData: boolean;
  staleCacheUsed: boolean;
}): AirspaceUiPresentation {
  if (!explorationEnabled) return { state: "IDLE", message: null };
  if (coverageStatus === "LOADING" && !hasData) {
    return { state: "LOADING", message: null };
  }
  if (coverageStatus === "PARTIAL") {
    return {
      state: "PARTIAL",
      message: "Espaces aériens partiellement disponibles",
    };
  }
  if (coverageStatus === "COMPLETE" && !hasData) {
    return {
      state: "NO_DATA",
      message: "Aucun espace aérien disponible dans cette zone",
    };
  }
  if (hasData) {
    return staleCacheUsed
      ? { state: "CACHE", message: "Données en cache" }
      : { state: "READY", message: null };
  }

  const relevantFailures = failures.filter(
    ({ category }) => category !== "ABORTED",
  );
  if (
    relevantFailures.length > 0 &&
    relevantFailures.every(({ category }) => category === "OFFLINE")
  ) {
    return {
      state: "OFFLINE",
      message: "Espaces aériens indisponibles hors ligne",
    };
  }
  if (relevantFailures.length > 0) {
    return {
      state: "ERROR",
      message: "Impossible de charger les espaces aériens",
    };
  }
  return { state: "LOADING", message: null };
}

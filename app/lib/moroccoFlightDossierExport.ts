import type { MoroccoDossierMapImage } from "./moroccoDossierMap.ts";
type DossierPdfMap = MoroccoDossierMapImage | { error: string };
import type { DossierPdfInput } from "./flightDossierPdf.ts";
import type { RecordedFlightPoint } from "./recordedFlight.ts";

export interface DossierExportEnvironment {
  renderMap(points: DossierPdfInput["dossier"]["points"], signal?: AbortSignal): Promise<DossierPdfMap>;
  createPdf(input: DossierPdfInput, map: DossierPdfMap): Promise<Uint8Array>;
  download(bytes: Uint8Array, filename: string): void;
}

export async function renderFlightDossierMap(points: DossierPdfInput["dossier"]["points"], signal?: AbortSignal): Promise<DossierPdfMap> {
  const { renderMoroccoDossierMap } = await import("./moroccoDossierMap.ts");
  const mapPoints: RecordedFlightPoint[] = points.map((point) => ({ timestamp: Date.parse(point.timestamp), latitude: point.latitude, longitude: point.longitude, altitudeMeters: point.altitudeAmslM, speedMetersPerSecond: null, headingDegrees: null, horizontalAccuracyMeters: null, verticalAccuracyMeters: null }));
  return renderMoroccoDossierMap(mapPoints, signal);
}

function browserEnvironment(): DossierExportEnvironment {
  return {
    renderMap: renderFlightDossierMap,
    createPdf: async (input, map) => (await import("./moroccoFlightDossierPdf.ts")).createMoroccoFlightDossierPdf(input, map),
    download: (bytes, filename) => {
      const blob = new Blob([Uint8Array.from(bytes).buffer], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url; link.download = filename; link.style.display = "none";
      try { document.body.appendChild(link); link.click(); }
      finally { link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 60_000); }
    },
  };
}

/** No calls at import/render time; this entry point is invoked by the dossier button. */
export async function exportMoroccoFlightDossier(input: DossierPdfInput, signal?: AbortSignal, environment: DossierExportEnvironment = browserEnvironment()) {
  signal?.throwIfAborted();
  const { dossier } = input;
  if (dossier.points.length < 2 || input.weather && (input.weather.traceId !== dossier.traceId || input.weather.weatherModel !== dossier.model.providerModelId) || dossier.operations && dossier.operations.traceId !== dossier.traceId) throw new Error("Données du dossier incompatibles avec la trace sélectionnée.");
  let map: DossierPdfMap;
  try { map = await environment.renderMap(dossier.points, signal); }
  catch (error) {
    signal?.throwIfAborted();
    map = { error: error instanceof Error ? error.message : "Rendu cartographique indisponible." };
  }
  signal?.throwIfAborted();
  const bytes = await environment.createPdf(input, map);
  signal?.throwIfAborted();
  const id = dossier.traceId.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 80) || "strategie";
  const filename = `preparation-maroc_${dossier.startedAt.slice(0, 10)}_${id}.pdf`;
  environment.download(bytes, filename);
  return { filename, mapUnavailable: "error" in map || map.background === "NEUTRAL" };
}

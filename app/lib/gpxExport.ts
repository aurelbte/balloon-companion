import type { RecordedFlight, RecordedFlightPoint } from "./recordedFlight.ts";

export const GPX_MIME_TYPE = "application/gpx+xml";

export type GpxFlightLabels = Readonly<{
  date?: string;
  departure?: string;
  arrival?: string;
}>;

export interface GpxExportEnvironment {
  share?: (data: ShareData) => Promise<void>;
  canShare?: (data: ShareData) => boolean;
  createObjectUrl(blob: Blob): string;
  revokeObjectUrl(url: string): void;
  createDownloadLink(): { href: string; download: string; click(): void; remove(): void };
  scheduleCleanup(callback: () => void): void;
}

function xmlEscape(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character]!);
}

function safeLocation(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed || null;
}

export function gpxTrackName(flight: RecordedFlight, labels: GpxFlightLabels = {}): string {
  const date = labels.date?.trim() || new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric" }).format(flight.startedAt);
  const departure = safeLocation(labels.departure ?? flight.startLocationLabel);
  const arrival = safeLocation(labels.arrival ?? flight.endLocationLabel);
  const route = departure && arrival ? `${departure} → ${arrival}` : departure ?? arrival ?? "Vol en montgolfière";
  return `Balloon Companion — ${date} — ${route}`;
}

function slug(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function gpxFilename(flight: RecordedFlight, labels: GpxFlightLabels = {}): string {
  const date = new Date(flight.startedAt);
  const datePart = Number.isFinite(date.getTime())
    ? [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-")
    : "vol";
  const locations = [safeLocation(labels.departure ?? flight.startLocationLabel), safeLocation(labels.arrival ?? flight.endLocationLabel)].filter((value): value is string => value !== null).map(slug).filter(Boolean);
  return `balloon-companion-${datePart}${locations.length ? `-${locations.join("-")}` : ""}.gpx`;
}

function validCoordinates(point: RecordedFlightPoint): boolean {
  return Number.isFinite(point.latitude) && point.latitude >= -90 && point.latitude <= 90 && Number.isFinite(point.longitude) && point.longitude >= -180 && point.longitude <= 180;
}

function pointXml(point: RecordedFlightPoint): string | null {
  if (!validCoordinates(point)) return null;
  const children: string[] = [];
  if (point.altitudeMeters !== null && Number.isFinite(point.altitudeMeters)) children.push(`<ele>${point.altitudeMeters}</ele>`);
  if (Number.isFinite(point.timestamp)) {
    try { children.push(`<time>${new Date(point.timestamp).toISOString()}</time>`); } catch { /* Horodatage hors plage : aucun élément time. */ }
  }
  return `<trkpt lat="${point.latitude}" lon="${point.longitude}">${children.join("")}</trkpt>`;
}

export function createGpx(flight: RecordedFlight, labels: GpxFlightLabels = {}): string {
  const points = flight.points.map(pointXml).filter((point): point is string => point !== null).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Balloon Companion" xmlns="http://www.topografix.com/GPX/1/1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">\n<trk><name>${xmlEscape(gpxTrackName(flight, labels))}</name><trkseg>\n${points}\n</trkseg></trk>\n</gpx>`;
}

export function createGpxFile(flight: RecordedFlight, labels: GpxFlightLabels = {}): File {
  return new File([createGpx(flight, labels)], gpxFilename(flight, labels), { type: GPX_MIME_TYPE });
}

function browserEnvironment(): GpxExportEnvironment {
  return {
    share: typeof navigator.share === "function" ? navigator.share.bind(navigator) : undefined,
    canShare: typeof navigator.canShare === "function" ? navigator.canShare.bind(navigator) : undefined,
    createObjectUrl: (blob) => URL.createObjectURL(blob),
    revokeObjectUrl: (url) => URL.revokeObjectURL(url),
    createDownloadLink: () => { const link = document.createElement("a"); link.style.display = "none"; document.body.appendChild(link); return link; },
    scheduleCleanup: (callback) => window.setTimeout(callback, 1_000),
  };
}

export async function exportGpx(flight: RecordedFlight, labels: GpxFlightLabels = {}, environment: GpxExportEnvironment = browserEnvironment()): Promise<"SHARED" | "DOWNLOADED" | "CANCELLED"> {
  const file = createGpxFile(flight, labels);
  const shareData: ShareData = { files: [file], title: "Balloon Companion — Trace GPX" };
  if (environment.share && environment.canShare?.(shareData)) {
    try {
      await environment.share(shareData);
      return "SHARED";
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return "CANCELLED";
    }
  }
  const url = environment.createObjectUrl(file);
  const link = environment.createDownloadLink();
  link.href = url;
  link.download = file.name;
  link.click();
  environment.scheduleCleanup(() => { link.remove(); environment.revokeObjectUrl(url); });
  return "DOWNLOADED";
}

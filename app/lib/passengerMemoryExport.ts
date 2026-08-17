import type { JournalFlight } from "./journalMockData.ts";
import type { RecordedFlight } from "./recordedFlight.ts";
import type { UnitPreferences } from "./unitPreferences.ts";
import { buildPassengerMemoryModel, passengerMemoryFilename } from "./passengerMemory.ts";
import { renderPassengerMemoryMap } from "./passengerMemoryMap.ts";
import { createPassengerMemoryPdf, PASSENGER_MEMORY_PDF_MIME } from "./passengerMemoryPdf.ts";
import type { PassengerMemoryBalloon } from "./passengerMemory.ts";

export interface PassengerMemoryExportEnvironment {
  share?: (data: ShareData) => Promise<void>;
  canShare?: (data: ShareData) => boolean;
  createObjectUrl(blob: Blob): string;
  revokeObjectUrl(url: string): void;
  createDownloadLink(): { href: string; download: string; click(): void; remove(): void };
  scheduleCleanup(callback: () => void): void;
  loadLogo(): Promise<Uint8Array>;
  renderMap(points: RecordedFlight["points"]): ReturnType<typeof renderPassengerMemoryMap>;
}

function browserEnvironment(): PassengerMemoryExportEnvironment {
  return {
    share: typeof navigator.share === "function" ? navigator.share.bind(navigator) : undefined,
    canShare: typeof navigator.canShare === "function" ? navigator.canShare.bind(navigator) : undefined,
    createObjectUrl: (blob) => URL.createObjectURL(blob),
    revokeObjectUrl: (url) => URL.revokeObjectURL(url),
    createDownloadLink: () => { const link = document.createElement("a"); link.style.display = "none"; document.body.appendChild(link); return link; },
    scheduleCleanup: (callback) => window.setTimeout(callback, 1_000),
    loadLogo: async () => new Uint8Array(await (await fetch("/branding/balloon-companion-logo-passenger.png")).arrayBuffer()),
    renderMap: renderPassengerMemoryMap,
  };
}

export async function exportPassengerMemory(input: Readonly<{
  recordedFlight: RecordedFlight;
  journalFlight: JournalFlight;
  units: UnitPreferences["flightInstruments"];
  displayedDuration: string;
  pilot: Readonly<{ firstName?: string; lastName?: string }> | null;
  selectedBalloon: PassengerMemoryBalloon;
}>, environment: PassengerMemoryExportEnvironment = browserEnvironment()): Promise<"SHARED" | "DOWNLOADED" | "CANCELLED"> {
  const model = buildPassengerMemoryModel(input);
  const [logoPng, mapImage] = await Promise.all([environment.loadLogo(), environment.renderMap(input.recordedFlight.points)]);
  const bytes = await createPassengerMemoryPdf(model, { logoPng, mapPng: mapImage.png });
  const file = new File([Uint8Array.from(bytes).buffer], passengerMemoryFilename(input.recordedFlight, input.journalFlight), { type: PASSENGER_MEMORY_PDF_MIME });
  const shareData: ShareData = { files: [file], title: "Balloon Companion - Souvenir de votre vol" };
  if (environment.share && environment.canShare?.(shareData)) {
    try { await environment.share(shareData); return "SHARED"; }
    catch (error) { if (error instanceof DOMException && error.name === "AbortError") return "CANCELLED"; }
  }
  const url = environment.createObjectUrl(file);
  const link = environment.createDownloadLink();
  link.href = url; link.download = file.name; link.click();
  environment.scheduleCleanup(() => { link.remove(); environment.revokeObjectUrl(url); });
  return "DOWNLOADED";
}

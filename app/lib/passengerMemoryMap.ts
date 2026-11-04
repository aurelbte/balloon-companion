import type { RecordedFlightPoint } from "./recordedFlight.ts";

export type PassengerMemoryMapImage = Readonly<{ png: Uint8Array; background: "OPENSTREETMAP" | "NEUTRAL" }>;

const WIDTH = 1400;
const HEIGHT = 570;
const PADDING = 80;

function validPoint(point: RecordedFlightPoint): boolean {
  return Number.isFinite(point.latitude) && Number.isFinite(point.longitude) && point.latitude >= -85 && point.latitude <= 85 && point.longitude >= -180 && point.longitude <= 180;
}

function mercator(longitude: number, latitude: number, zoom: number): { x: number; y: number } {
  const scale = 256 * 2 ** zoom;
  const sin = Math.sin(latitude * Math.PI / 180);
  return { x: (longitude + 180) / 360 * scale, y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale };
}

function chooseZoom(points: readonly RecordedFlightPoint[], width = WIDTH, height = HEIGHT, minimumZoom = 2): number {
  const widthLimit = width, heightLimit = height;
  for (let zoom = 15; zoom >= minimumZoom; zoom -= 1) {
    const projected = points.map((point) => mercator(point.longitude, point.latitude, zoom));
    const width = Math.max(...projected.map(({ x }) => x)) - Math.min(...projected.map(({ x }) => x));
    const height = Math.max(...projected.map(({ y }) => y)) - Math.min(...projected.map(({ y }) => y));
    if (width <= widthLimit - PADDING * 2 && height <= heightLimit - PADDING * 2) return zoom;
  }
  return minimumZoom;
}

async function canvasPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Canvas PNG indisponible")), "image/png"));
  return new Uint8Array(await blob.arrayBuffer());
}

export async function renderPassengerMemoryMap(pointsInput: readonly RecordedFlightPoint[], dossierOptions?: { signal?: AbortSignal }): Promise<PassengerMemoryMapImage> {
  const WIDTH = 1400;
  const HEIGHT = dossierOptions ? 1850 : 570;
  if (dossierOptions && (pointsInput.some((point) => !validPoint(point)) || pointsInput.some((point, index) => index > 0 && Math.abs(point.longitude - pointsInput[index - 1].longitude) > 180))) throw new Error("Projection cartographique indisponible pour cette trace (latitude ou passage de l’antiméridien).");
  const points = pointsInput.filter(validPoint);
  if (points.length === 0) throw new Error("Trace GPS indisponible");
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas indisponible");
  context.fillStyle = "#dce8f2";
  context.fillRect(0, 0, WIDTH, HEIGHT);
  const zoom = chooseZoom(points, WIDTH, HEIGHT, dossierOptions ? 0 : 2);
  const projected = points.map((point) => mercator(point.longitude, point.latitude, zoom));
  const minX = Math.min(...projected.map(({ x }) => x));
  const maxX = Math.max(...projected.map(({ x }) => x));
  const minY = Math.min(...projected.map(({ y }) => y));
  const maxY = Math.max(...projected.map(({ y }) => y));
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const originX = centerX - WIDTH / 2;
  const originY = centerY - HEIGHT / 2;
  let background: PassengerMemoryMapImage["background"] = "NEUTRAL";

  if (typeof fetch === "function" && (typeof navigator === "undefined" || navigator.onLine)) {
    const firstTileX = Math.floor(originX / 256);
    const lastTileX = Math.floor((originX + WIDTH) / 256);
    const firstTileY = Math.floor(originY / 256);
    const lastTileY = Math.floor((originY + HEIGHT) / 256);
    const tiles = [] as Array<{ image: ImageBitmap; x: number; y: number }>;
    const controller = dossierOptions ? new AbortController() : null;
    const abort = () => controller?.abort();
    dossierOptions?.signal?.addEventListener("abort", abort, { once: true });
    if (dossierOptions?.signal?.aborted) abort();
    const timeout = controller ? setTimeout(abort, 8_000) : null;
    try {
      const loadTile = async (x: number, y: number) => {
        const response = await fetch(`https://tile.openstreetmap.org/${zoom}/${x}/${y}.png`, { cache: "force-cache", ...(controller ? { signal: controller.signal } : {}) });
        if (!response.ok) throw new Error("Tuile indisponible");
        tiles.push({ image: await createImageBitmap(await response.blob()), x, y });
      };
      if (dossierOptions) {
        const queue: Array<[number, number]> = [];
        for (let y = firstTileY; y <= lastTileY; y++) for (let x = firstTileX; x <= lastTileX; x++) queue.push([x, y]);
        const workers = Array.from({ length: 4 }, async () => {
          while (queue.length) {
            const [x, y] = queue.shift()!;
            try { await loadTile(x, y); } catch (error) { controller?.abort(); throw error; }
          }
        });
        const results = await Promise.allSettled(workers);
        if (results.some((result) => result.status === "rejected")) throw new Error("Fond cartographique indisponible.");
      } else {
        for (let y = firstTileY; y <= lastTileY; y++) for (let x = firstTileX; x <= lastTileX; x++) await loadTile(x, y);
      }
      for (const tile of tiles) context.drawImage(tile.image, tile.x * 256 - originX, tile.y * 256 - originY, 256, 256);
      background = "OPENSTREETMAP";
    } catch { /* Le fond neutre déjà dessiné garantit le souvenir hors ligne. */ }
    finally {
      if (timeout !== null) clearTimeout(timeout);
      dossierOptions?.signal?.removeEventListener("abort", abort);
      tiles.forEach(({ image }) => image.close());
    }
  }

  context.lineCap = "round";
  context.lineJoin = "round";
  context.strokeStyle = "rgba(7,17,31,.72)";
  context.lineWidth = 14;
  context.beginPath();
  projected.forEach((point, index) => index === 0 ? context.moveTo(point.x - originX, point.y - originY) : context.lineTo(point.x - originX, point.y - originY));
  context.stroke();
  context.strokeStyle = "#4f9ee3";
  context.lineWidth = 7;
  context.stroke();
  for (const [point, color] of [[projected[0], "#45ad7b"], [projected.at(-1)!, "#ffffff"]] as const) {
    context.beginPath(); context.arc(point.x - originX, point.y - originY, 14, 0, Math.PI * 2); context.fillStyle = color; context.fill(); context.lineWidth = 5; context.strokeStyle = "#07111f"; context.stroke();
  }
  if (dossierOptions) {
    dossierOptions.signal?.throwIfAborted();
    context.font = "bold 26px sans-serif";
    context.fillStyle = "#07111f";
    context.textAlign = "left";
    for (const [label, x, y] of [["D", projected[0].x - originX - 48, projected[0].y - originY + 16], ["A", projected.at(-1)!.x - originX + 18, projected.at(-1)!.y - originY + 10]] as const) {
      context.fillStyle = "#ffffff"; context.fillRect(x, y, 36, 36);
      context.fillStyle = "#07111f"; context.fillText(label, x + 7, y + 27);
    }
    const middleLatitude = Math.atan(Math.sinh(Math.PI * (1 - 2 * centerY / (256 * 2 ** zoom)))) * 180 / Math.PI;
    const metersPerPixel = 156543.03392804097 * Math.cos(middleLatitude * Math.PI / 180) / 2 ** zoom;
    const target = metersPerPixel * 220;
    const magnitude = 10 ** Math.floor(Math.log10(target));
    const distance = [5, 2, 1].map((value) => value * magnitude).find((value) => value <= target) ?? magnitude / 2;
    const barWidth = distance / metersPerPixel;
    context.fillStyle = "rgba(255,255,255,.94)";
    context.fillRect(22, HEIGHT - 116, Math.max(330, barWidth + 36), 96);
    context.strokeStyle = "#07111f";
    context.lineWidth = 4;
    context.beginPath(); context.moveTo(40, HEIGHT - 70); context.lineTo(40 + barWidth, HEIGHT - 70); context.stroke();
    context.font = "22px sans-serif";
    context.fillStyle = "#07111f";
    context.fillText(`${distance >= 1000 ? `${distance / 1000} km` : `${distance} m`} (au centre)`, 40, HEIGHT - 84);
    context.fillText("D : départ / A : arrivée prévue", 40, HEIGHT - 38);
  }
  context.fillStyle = "rgba(7,17,31,.78)";
  context.fillRect(WIDTH - (dossierOptions ? 530 : 320), HEIGHT - 42, dossierOptions ? 530 : 320, 42);
  context.fillStyle = "#ffffff";
  context.font = "22px sans-serif";
  context.textAlign = "right";
  context.fillText(background === "OPENSTREETMAP" ? "© OpenStreetMap contributors" : dossierOptions ? "Trajectoire prévue - fond indisponible" : "Trajectoire GPS - fond hors ligne", WIDTH - 16, HEIGHT - 14);
  return { png: await canvasPng(canvas), background };
}

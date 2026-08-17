import type { RecordedFlightPoint } from "./recordedFlight.ts";

export type PassengerMemoryMapImage = Readonly<{ png: Uint8Array; background: "OPENSTREETMAP" | "NEUTRAL" }>;

const WIDTH = 1400;
const HEIGHT = 620;
const PADDING = 90;

function validPoint(point: RecordedFlightPoint): boolean {
  return Number.isFinite(point.latitude) && Number.isFinite(point.longitude) && point.latitude >= -85 && point.latitude <= 85 && point.longitude >= -180 && point.longitude <= 180;
}

function mercator(longitude: number, latitude: number, zoom: number): { x: number; y: number } {
  const scale = 256 * 2 ** zoom;
  const sin = Math.sin(latitude * Math.PI / 180);
  return { x: (longitude + 180) / 360 * scale, y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale };
}

function chooseZoom(points: readonly RecordedFlightPoint[]): number {
  for (let zoom = 15; zoom >= 2; zoom -= 1) {
    const projected = points.map((point) => mercator(point.longitude, point.latitude, zoom));
    const width = Math.max(...projected.map(({ x }) => x)) - Math.min(...projected.map(({ x }) => x));
    const height = Math.max(...projected.map(({ y }) => y)) - Math.min(...projected.map(({ y }) => y));
    if (width <= WIDTH - PADDING * 2 && height <= HEIGHT - PADDING * 2) return zoom;
  }
  return 2;
}

async function canvasPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Canvas PNG indisponible")), "image/png"));
  return new Uint8Array(await blob.arrayBuffer());
}

export async function renderPassengerMemoryMap(pointsInput: readonly RecordedFlightPoint[]): Promise<PassengerMemoryMapImage> {
  const points = pointsInput.filter(validPoint);
  if (points.length === 0) throw new Error("Trace GPS indisponible");
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas indisponible");
  context.fillStyle = "#dce8f2";
  context.fillRect(0, 0, WIDTH, HEIGHT);
  const zoom = chooseZoom(points);
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
    try {
      for (let y = firstTileY; y <= lastTileY; y += 1) for (let x = firstTileX; x <= lastTileX; x += 1) {
        const response = await fetch(`https://tile.openstreetmap.org/${zoom}/${x}/${y}.png`, { cache: "force-cache" });
        if (!response.ok) throw new Error("Tuile indisponible");
        tiles.push({ image: await createImageBitmap(await response.blob()), x, y });
      }
      for (const tile of tiles) context.drawImage(tile.image, tile.x * 256 - originX, tile.y * 256 - originY, 256, 256);
      background = "OPENSTREETMAP";
    } catch { /* Le fond neutre déjà dessiné garantit le souvenir hors ligne. */ }
    finally { tiles.forEach(({ image }) => image.close()); }
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
  context.fillStyle = "rgba(7,17,31,.78)";
  context.fillRect(WIDTH - 320, HEIGHT - 42, 320, 42);
  context.fillStyle = "#ffffff";
  context.font = "22px sans-serif";
  context.textAlign = "right";
  context.fillText(background === "OPENSTREETMAP" ? "© OpenStreetMap contributors" : "Trajectoire GPS - fond hors ligne", WIDTH - 16, HEIGHT - 14);
  return { png: await canvasPng(canvas), background };
}

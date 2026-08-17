import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { PassengerMemoryModel } from "./passengerMemory.ts";

export const PASSENGER_MEMORY_PDF_MIME = "application/pdf";
const A4: [number, number] = [595.28, 841.89];

function pdfText(value: string): string {
  return value.replace(/[’‘]/g, "'").replace(/[–—]/g, "-").replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");
}

function fittedText(value: string, font: PDFFont, preferredSize: number, maximumWidth: number): { text: string; size: number } {
  const text = pdfText(value);
  let size = preferredSize;
  while (size > 10 && font.widthOfTextAtSize(text, size) > maximumWidth) size -= 0.5;
  if (font.widthOfTextAtSize(text, size) <= maximumWidth) return { text, size };
  let shortened = text;
  while (shortened.length > 1 && font.widthOfTextAtSize(`${shortened}...`, size) > maximumWidth) shortened = shortened.slice(0, -1);
  return { text: `${shortened}...`, size };
}

function centered(page: PDFPage, text: string, y: number, font: PDFFont, size: number, color = rgb(0.05, 0.11, 0.19)): void {
  const safe = pdfText(text);
  page.drawText(safe, { x: (A4[0] - font.widthOfTextAtSize(safe, size)) / 2, y, font, size, color });
}

function compactRoute(page: PDFPage, departureValue: string, arrivalValue: string, y: number, font: PDFFont, color: ReturnType<typeof rgb>, accent: ReturnType<typeof rgb>): void {
  const departure = pdfText(departureValue);
  const arrival = pdfText(arrivalValue);
  const arrowWidth = 20;
  const gap = 10;
  const maximumWidth = 511;
  let size = 20;
  while (size > 10 && font.widthOfTextAtSize(departure, size) + font.widthOfTextAtSize(arrival, size) + arrowWidth + gap * 2 > maximumWidth) size -= 0.5;
  const departureWidth = font.widthOfTextAtSize(departure, size);
  const arrivalWidth = font.widthOfTextAtSize(arrival, size);
  const groupWidth = departureWidth + arrivalWidth + arrowWidth + gap * 2;
  const startX = (A4[0] - groupWidth) / 2;
  page.drawText(departure, { x: startX, y, font, size, color });
  const arrowStart = startX + departureWidth + gap;
  const arrowEnd = arrowStart + arrowWidth;
  const arrowY = y + size * 0.38;
  page.drawLine({ start: { x: arrowStart, y: arrowY }, end: { x: arrowEnd, y: arrowY }, thickness: 2, color: accent });
  page.drawLine({ start: { x: arrowEnd - 6, y: arrowY + 4 }, end: { x: arrowEnd, y: arrowY }, thickness: 2, color: accent });
  page.drawLine({ start: { x: arrowEnd - 6, y: arrowY - 4 }, end: { x: arrowEnd, y: arrowY }, thickness: 2, color: accent });
  page.drawText(arrival, { x: arrowEnd + gap, y, font, size, color });
}

export async function createPassengerMemoryPdf(model: PassengerMemoryModel, assets: Readonly<{ logoPng: Uint8Array; mapPng: Uint8Array }>): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const page = document.addPage(A4);
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const navy = rgb(0.027, 0.067, 0.122);
  const blue = rgb(0.31, 0.62, 0.89);
  const muted = rgb(0.38, 0.45, 0.53);
  const pale = rgb(0.94, 0.97, 0.99);
  page.drawRectangle({ x: 0, y: 0, width: A4[0], height: A4[1], color: rgb(1, 1, 1) });
  page.drawRectangle({ x: 0, y: 704, width: A4[0], height: 138, color: navy });

  const logo = await document.embedPng(assets.logoPng);
  const logoScale = Math.min(220 / logo.width, 82 / logo.height);
  const logoWidth = logo.width * logoScale;
  page.drawImage(logo, { x: (A4[0] - logoWidth) / 2, y: 754, width: logoWidth, height: logo.height * logoScale });
  centered(page, "VOTRE VOL EN MONTGOLFIERE", 728, bold, 15, rgb(1, 1, 1));
  centered(page, model.date, 711, regular, 10, rgb(0.76, 0.84, 0.91));

  compactRoute(page, model.departure, model.arrival, 666, bold, navy, blue);

  page.drawRectangle({ x: 36, y: 350, width: 523, height: 285, color: pale, borderColor: rgb(0.83, 0.88, 0.92), borderWidth: 1 });
  const map = await document.embedPng(assets.mapPng);
  const mapScale = Math.min(511 / map.width, 273 / map.height);
  page.drawImage(map, { x: (A4[0] - map.width * mapScale) / 2, y: 356 + (273 - map.height * mapScale) / 2, width: map.width * mapScale, height: map.height * mapScale });

  const metrics = [
    ["DUREE", model.displayedDuration],
    ["DISTANCE", model.distance],
    ["ALTITUDE MAX", model.maximumAltitude],
    ["VITESSE MAX", model.maximumSpeed],
  ] as const;
  const metricWidth = 124;
  metrics.forEach(([label, value], index) => {
    const x = 36 + index * 131;
    page.drawRectangle({ x, y: 222, width: metricWidth, height: 92, color: index === 0 ? navy : pale });
    page.drawText(label, { x: x + 12, y: 286, font: bold, size: 8, color: index === 0 ? rgb(0.65, 0.81, 0.94) : muted });
    const fitted = fittedText(value, bold, 17, metricWidth - 24);
    page.drawText(fitted.text, { x: x + 12, y: 249, font: bold, size: fitted.size, color: index === 0 ? rgb(1, 1, 1) : navy });
  });

  page.drawLine({ start: { x: 36, y: 180 }, end: { x: 559, y: 180 }, thickness: 1, color: rgb(0.86, 0.89, 0.92) });
  if (model.pilotName) {
    centered(page, "Votre pilote", 128, regular, 10, muted);
    centered(page, model.pilotName, 103, bold, 17, navy);
  }
  return document.save({ useObjectStreams: false });
}

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

function centeredFitted(page: PDFPage, text: string, y: number, font: PDFFont, size: number, maximumWidth: number, color: ReturnType<typeof rgb>): void {
  const fitted = fittedText(text, font, size, maximumWidth);
  centered(page, fitted.text, y, font, fitted.size, color);
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
  centeredFitted(page, `Votre vol du ${model.date}`, 720, bold, 14, 511, rgb(1, 1, 1));

  compactRoute(page, model.departure, model.arrival, 666, bold, navy, blue);

  page.drawRectangle({ x: 36, y: 405, width: 523, height: 220, color: pale, borderColor: rgb(0.83, 0.88, 0.92), borderWidth: 1 });
  const map = await document.embedPng(assets.mapPng);
  const mapScale = Math.min(511 / map.width, 208 / map.height);
  page.drawImage(map, { x: (A4[0] - map.width * mapScale) / 2, y: 411 + (208 - map.height * mapScale) / 2, width: map.width * mapScale, height: map.height * mapScale });

  const metrics = [
    ["DURÉE", model.displayedDuration],
    ["DISTANCE", model.distance],
    ["ALTITUDE MAX", model.maximumAltitude],
    ["VITESSE MAX", model.maximumSpeed],
  ] as const;
  page.drawLine({ start: { x: 36, y: 370 }, end: { x: 559, y: 370 }, thickness: 1, color: rgb(0.82, 0.87, 0.91) });
  page.drawLine({ start: { x: 297.5, y: 207 }, end: { x: 297.5, y: 355 }, thickness: 0.6, color: rgb(0.86, 0.89, 0.92) });
  page.drawLine({ start: { x: 52, y: 281 }, end: { x: 543, y: 281 }, thickness: 0.6, color: rgb(0.86, 0.89, 0.92) });
  const metricWidth = 261.5;
  metrics.forEach(([label, value], index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);
    const centerX = 36 + column * metricWidth + metricWidth / 2;
    const labelY = row === 0 ? 337 : 263;
    const valueY = row === 0 ? 309 : 235;
    const safeLabel = pdfText(label);
    page.drawText(safeLabel, { x: centerX - bold.widthOfTextAtSize(safeLabel, 8) / 2, y: labelY, font: bold, size: 8, color: blue });
    const fitted = fittedText(value, bold, 17, metricWidth - 32);
    page.drawText(fitted.text, { x: centerX - bold.widthOfTextAtSize(fitted.text, fitted.size) / 2, y: valueY, font: bold, size: fitted.size, color: navy });
  });

  page.drawLine({ start: { x: 36, y: 191 }, end: { x: 559, y: 191 }, thickness: 1, color: rgb(0.82, 0.87, 0.91) });
  page.drawLine({ start: { x: A4[0] / 2, y: 82 }, end: { x: A4[0] / 2, y: 163 }, thickness: 0.6, color: rgb(0.86, 0.89, 0.92) });
  const drawMemoryLabel = (label: string, centerX: number) => {
    const safeLabel = pdfText(label);
    page.drawText(safeLabel, { x: centerX - bold.widthOfTextAtSize(safeLabel, 9) / 2, y: 151, font: bold, size: 9, color: muted });
  };
  if (model.balloon) {
    const centerX = A4[0] * 0.27;
    drawMemoryLabel("VOTRE BALLON", centerX);
    const balloonLines = [model.balloon.name, model.balloon.registration].filter((value): value is string => Boolean(value));
    balloonLines.forEach((value, index) => {
      const fitted = fittedText(value, bold, 15, 230);
      page.drawText(fitted.text, { x: centerX - bold.widthOfTextAtSize(fitted.text, fitted.size) / 2, y: balloonLines.length === 1 ? 112 : 121 - index * 24, font: bold, size: fitted.size, color: navy });
    });
  }
  if (model.pilotName) {
    const centerX = A4[0] * 0.73;
    drawMemoryLabel("VOTRE PILOTE", centerX);
    const fitted = fittedText(model.pilotName, bold, 15, 230);
    page.drawText(fitted.text, { x: centerX - bold.widthOfTextAtSize(fitted.text, fitted.size) / 2, y: 109, font: bold, size: fitted.size, color: navy });
  }
  return document.save({ useObjectStreams: false });
}

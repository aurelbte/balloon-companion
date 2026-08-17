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
    ["Durée", model.displayedDuration],
    ["Distance", model.distance],
    ["Altitude max", model.maximumAltitude],
    ["Vitesse max", model.maximumSpeed],
  ] as const;
  page.drawRectangle({ x: 36, y: 205, width: 523, height: 165, color: pale, borderColor: rgb(0.86, 0.9, 0.93), borderWidth: 1 });
  page.drawRectangle({ x: 52, y: 340, width: 24, height: 3, color: blue });
  page.drawText("Votre vol en chiffres", { x: 84, y: 334, font: bold, size: 13, color: navy });
  page.drawLine({ start: { x: 297.5, y: 220 }, end: { x: 297.5, y: 315 }, thickness: 0.7, color: rgb(0.82, 0.87, 0.91) });
  page.drawLine({ start: { x: 52, y: 267 }, end: { x: 543, y: 267 }, thickness: 0.7, color: rgb(0.82, 0.87, 0.91) });
  const metricWidth = 245.5;
  metrics.forEach(([label, value], index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);
    const x = 52 + column * metricWidth;
    const labelY = row === 0 ? 305 : 254;
    const valueY = row === 0 ? 280 : 229;
    page.drawText(label, { x: x + 12, y: labelY, font: regular, size: 9, color: muted });
    const fitted = fittedText(value, bold, 17, metricWidth - 32);
    page.drawText(fitted.text, { x: x + 12, y: valueY, font: bold, size: fitted.size, color: navy });
  });

  page.drawLine({ start: { x: 36, y: 177 }, end: { x: 559, y: 177 }, thickness: 1, color: rgb(0.86, 0.89, 0.92) });
  const memories = [
    ...(model.balloon ? [["Votre ballon", model.balloon.label] as const] : []),
    ...(model.pilotName ? [["Votre pilote", model.pilotName] as const] : []),
  ];
  memories.forEach(([label, value], index) => {
    const centerX = memories.length === 1 ? A4[0] / 2 : index === 0 ? A4[0] * 0.29 : A4[0] * 0.71;
    const maximumWidth = memories.length === 1 ? 480 : 230;
    const safeLabel = pdfText(label);
    page.drawText(safeLabel, { x: centerX - regular.widthOfTextAtSize(safeLabel, 10) / 2, y: 129, font: regular, size: 10, color: muted });
    const fitted = fittedText(value, bold, 16, maximumWidth);
    page.drawText(fitted.text, { x: centerX - bold.widthOfTextAtSize(fitted.text, fitted.size) / 2, y: 103, font: bold, size: fitted.size, color: navy });
  });
  if (memories.length === 2) {
    page.drawLine({ start: { x: A4[0] / 2, y: 94 }, end: { x: A4[0] / 2, y: 145 }, thickness: 0.7, color: rgb(0.86, 0.89, 0.92) });
  }
  return document.save({ useObjectStreams: false });
}

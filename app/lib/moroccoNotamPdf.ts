import { PDFName, rgb, type PDFDocument, type PDFFont, type PDFPage } from "pdf-lib";
import { addMoroccoEditableText } from "./moroccoEditableFields.ts";

/** Only complete weather blocks already present on page 7 may be compacted. */
export type MoroccoNotamWindBlock = {
  label: string;
  tables: { headers: string[]; widths: number[]; rows: string[][] }[];
  missing: string[];
  warnings: string[];
};
type Wrap = (text: string, font: PDFFont, size: number, width: number) => string[];
const MARGIN = 42, BOTTOM = 52, BODY_TOP = 757.89, WIDTH = 511.28;
const BLUE = rgb(.06, .36, .48), INK = rgb(.08, .15, .23), MUTED = rgb(.35, .41, .47);
export const MOROCCO_NOTAM_HEIGHT = 174;
export const MOROCCO_NOTAM_FIELD = "vol-notam-commentaire";

/** Exact text equality only. The scope explicitly lists the original time labels. */
export function moroccoNotamWarningGroups(blocks: MoroccoNotamWindBlock[]) {
  const groups = new Map<string, number[]>();
  blocks.forEach((block, index) => {
    for (const warning of new Set(block.warnings)) groups.set(warning, [...(groups.get(warning) ?? []), index]);
  });
  return [...groups].map(([text, indexes]) => ({ text, indexes }));
}

function weatherInstructions(blocks: MoroccoNotamWindBlock[]) {
  const groups = moroccoNotamWarningGroups(blocks);
  const common = groups.filter(group => group.indexes.length === blocks.length);
  return {
    common,
    // Non-common warnings remain beneath each applicable profile: no scope change.
    local: blocks.map(block => block.warnings.filter(text => !common.some(group => group.text === text))),
  };
}

/** Measurement and drawing use exactly the same line wrapping and spacing. No font reduction. */
function weatherBody(page: PDFPage | null, font: PDFFont, bold: PDFFont, wrap: Wrap, blocks: MoroccoNotamWindBlock[], padding: number) {
  let y = BODY_TOP;
  const paragraph = (text: string, size: number, strong = false, muted = false, gap = 1) => {
    const face = strong ? bold : font;
    for (const line of wrap(text, face, size, WIDTH)) {
      page?.drawText(line, { x: MARGIN, y: y - size, size, font: face, color: muted ? MUTED : INK });
      y -= size * 1.25;
    }
    y -= gap;
  };
  const instructions = weatherInstructions(blocks);
  blocks.forEach((block, index) => {
    paragraph(block.label, 9, true, false, 2);
    for (const message of block.missing) paragraph(message, 9);
    for (const table of block.tables) {
      [table.headers, ...table.rows].forEach((row, rowIndex) => {
        const face = rowIndex === 0 ? bold : font;
        const cells = table.widths.map((width, cell) => wrap(row[cell] || "indisponible", face, 8.2, width - 6));
        const height = Math.max(...cells.map(lines => lines.length)) * 10.5 + 2 * padding;
        if (rowIndex === 0 || rowIndex % 2 === 1) page?.drawRectangle({ x: MARGIN, y: y - height, width: WIDTH, height, color: rowIndex === 0 ? BLUE : rgb(.94, .96, .97) });
        let x = MARGIN;
        cells.forEach((lines, cell) => {
          lines.forEach((line, offset) => page?.drawText(line, { x: x + 3, y: y - padding - 8.2 - offset * 10.5, size: 8.2, font: face, color: rowIndex === 0 ? rgb(1, 1, 1) : INK }));
          x += table.widths[cell];
        });
        y -= height;
        if (rowIndex > 0) page?.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + WIDTH, y }, thickness: .35, color: rgb(.82, .87, .89) });
      });
      y -= 4;
    }
    for (const warning of instructions.local[index]) paragraph(warning, 8, false, true);
  });
  if (instructions.common.length) {
    paragraph("Pour toutes les échéances de cette page :", 8, true, true);
    for (const warning of instructions.common) paragraph(warning.text, 8, false, true);
  }
  return y;
}

/** Original page, widgets, page count and footer are retained. Never reflow following pages. */
export async function addMoroccoNotamPanel(document: PDFDocument, page: PDFPage, font: PDFFont, bold: PDFFont, wrap: Wrap, options: {
  bodyEndY: number;
  completeWeatherBlocks?: MoroccoNotamWindBlock[];
}): Promise<{ added: boolean; widthMm?: number; heightMm?: number }> {
  const top = BOTTOM + MOROCCO_NOTAM_HEIGHT;
  const blocks = options.completeWeatherBlocks;
  let padding = 2;
  let compact = false;
  if (options.bodyEndY < top + 6) {
    if (!blocks?.length || page.node.Annots()?.size()) return { added: false };
    if (weatherBody(null, font, bold, wrap, blocks, padding) < top + 6) padding = 1.5;
    if (weatherBody(null, font, bold, wrap, blocks, padding) < top + 6) return { added: false };
    compact = true;
  }
  if (compact) {
    // Embed the unmodified header/footer NOW, before replacing contents. No white overlays.
    const header = await document.embedPage(page, { left: 0, bottom: 780.89, right: 595.28, top: 841.89 });
    const footer = await document.embedPage(page, { left: 0, bottom: 0, right: 595.28, top: BOTTOM });
    await header.embed(); await footer.embed();
    const replacement = document.addPage([595.28, 841.89]);
    replacement.drawPage(header, { x: 0, y: 780.89 });
    replacement.drawPage(footer, { x: 0, y: 0 });
    weatherBody(replacement, font, bold, wrap, blocks!, padding);
    drawPanel(replacement);
    page.node.set(PDFName.of("Contents"), replacement.node.get(PDFName.of("Contents"))!);
    page.node.set(PDFName.of("Resources"), replacement.node.get(PDFName.of("Resources"))!);
    document.removePage(document.getPageCount() - 1);
  } else drawPanel(page);
  addMoroccoEditableText(document, page, font, { name: MOROCCO_NOTAM_FIELD, label: "Commentaire NOTAM", value: "", x: MARGIN + 6, y: BOTTOM + 6,
    width: WIDTH / 2 - 12, height: MOROCCO_NOTAM_HEIGHT - 28 - 16 - 6, size: 9, multiline: true });
  return { added: true, widthMm: (WIDTH / 2 - 12) * 25.4 / 72, heightMm: 124 * 25.4 / 72 };

  function drawPanel(target: PDFPage) {
    target.drawRectangle({ x: MARGIN, y: BOTTOM, width: WIDTH, height: MOROCCO_NOTAM_HEIGHT, borderColor: BLUE, borderWidth: .6 });
    target.drawRectangle({ x: MARGIN, y: top - 28, width: WIDTH, height: 28, color: BLUE });
    const title = "NOTAM", size = 18;
    const ascent = bold.heightAtSize(size, { descender: false });
    target.drawText(title, { x: MARGIN + (WIDTH - bold.widthOfTextAtSize(title, size)) / 2, y: top - 14 - ascent / 2, font: bold, size, color: rgb(1, 1, 1) });
    target.drawLine({ start: { x: MARGIN + WIDTH / 2, y: BOTTOM }, end: { x: MARGIN + WIDTH / 2, y: top - 28 }, thickness: .5, color: BLUE });
    target.drawText("Commentaire", { x: MARGIN + 6, y: top - 40, font: bold, size: 9, color: INK });
    target.drawText("Signature", { x: MARGIN + WIDTH / 2 + 6, y: top - 40, font: bold, size: 9, color: INK });
  }
}

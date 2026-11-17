import { PDFDocument, PDFDict, PDFHexString, PDFName, PDFRef, PDFStream, PDFString, PDFTextField, StandardFonts } from "pdf-lib";
import { moroccoFlightPlanBase64 } from "./moroccoFlightPlanAsset.ts";
import { prepareMoroccoPassengers, type MoroccoDossierPdfInput } from "./moroccoPassengers.ts";
import { calculateMoroccoLoading } from "./moroccoDossierLoading.ts";

export const MOROCCO_FLIGHT_PLAN_FIELDS = ["7", "8a", "8b", "9n", "9t", "9w", "10", "13", "13t", "15s", "15l", "15r", "15route", "16", "16e", "16a", "16b", "18", "18b", "E", "P", "R", "S", "J", "D", "A", "N", "C", "contact"] as const;
export const MOROCCO_FLIGHT_PLAN_PREFIX = "fpl-maroc-";

/** Only a complete, valid source date/time with explicit offset establishes an EOBT in UTC. */
export function moroccoFlightPlanUtc(iso: string): { time: string; date: string } | null {
  const m = typeof iso === "string" ? iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/) : null;
  if (!m) return null;
  const [, y, month, day, hour, minute, second] = m;
  const days = new Date(Date.UTC(Number(y), Number(month), 0)).getUTCDate();
  if (Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > days || Number(hour) > 23 || Number(minute) > 59 || Number(second ?? 0) > 59) return null;
  const value = new Date(iso);
  if (!Number.isFinite(value.getTime())) return null;
  return { time: `${String(value.getUTCHours()).padStart(2, "0")}${String(value.getUTCMinutes()).padStart(2, "0")}`,
    date: value.toISOString().slice(2, 10).replaceAll("-", "") };
}

export function moroccoFlightPlanPrefill(input: MoroccoDossierPdfInput): Partial<Record<typeof MOROCCO_FLIGHT_PLAN_FIELDS[number], string>> {
  const rows = prepareMoroccoPassengers(input.passengers);
  const values: Partial<Record<typeof MOROCCO_FLIGHT_PLAN_FIELDS[number], string>> = {};
  const registration = input.dossier.balloon.registration?.trim();
  if (registration) values["7"] = registration;
  if (input.pilotName?.trim()) values.C = input.pilotName.trim();
  const loading = input.loading ? calculateMoroccoLoading(input.passengers ?? [], input.loading) : null;
  const crew = input.flightPlanCrewOnBoardCount ?? (loading ? 1 : null);
  if (crew !== null) {
    if (!Number.isSafeInteger(crew) || crew < 1) throw new Error("Plan de vol Maroc : effectif d’équipage à bord invalide.");
    values.P = String(rows.filter(r => r.sex !== "").length + crew);
  } else values.P = ""; // Never confuse a passenger count with persons on board, or count ground crew.
  const utc = moroccoFlightPlanUtc(input.dossier.startedAt);
  values["13t"] = utc?.time ?? ""; // The template's "UTC +1" is an offset label, never an EOBT.
  const seconds = input.dossier.durationSeconds;
  if (Number.isFinite(seconds) && seconds > 0 && seconds % 60 === 0 && seconds < 100 * 3600) {
    const minutes = seconds / 60;
    values["16e"] = `${String(Math.floor(minutes / 60)).padStart(2, "0")}${String(minutes % 60).padStart(2, "0")}`;
  }
  return values;
}

/** Insert the native source page and register the SAME copied widget objects in the target AcroForm. */
export async function insertMoroccoFlightPlan(document: PDFDocument, input: MoroccoDossierPdfInput, afterPaxIndex = 0) {
  const source = await PDFDocument.load(moroccoFlightPlanBase64, { updateMetadata: false });
  const sourceFields = source.getForm().getFields();
  if (source.getPageCount() !== 1 || sourceFields.length !== MOROCCO_FLIGHT_PLAN_FIELDS.length ||
    sourceFields.some(f => !(f instanceof PDFTextField) || !MOROCCO_FLIGHT_PLAN_FIELDS.includes(f.getName() as typeof MOROCCO_FLIGHT_PLAN_FIELDS[number]))) throw new Error("Modèle du plan de vol Maroc incompatible : une page et 29 champs texte attendus.");
  const form = document.getForm();
  for (const name of MOROCCO_FLIGHT_PLAN_FIELDS) if (form.getFieldMaybe(`${MOROCCO_FLIGHT_PLAN_PREFIX}${name}`)) throw new Error("Collision de champs du plan de vol Maroc.");
  const values = moroccoFlightPlanPrefill(input);
  const [page] = await document.copyPages(source, [0]);
  document.insertPage(afterPaxIndex + 1, page);
  // Match the dossier's stream-array convention without changing the source drawing stream.
  if (page.node.Contents() instanceof PDFStream) page.node.set(PDFName.of("Contents"), document.context.obj([page.node.get(PDFName.of("Contents"))!]));
  page.node.delete(PDFName.of("StructParents"));
  const annotations = page.node.Annots();
  if (!annotations || annotations.size() !== MOROCCO_FLIGHT_PLAN_FIELDS.length) throw new Error("Widgets du plan de vol Maroc incomplets.");
  // A unique resource name prevents imported /Helv from colliding with existing dossier fonts.
  const font = await document.embedFont(StandardFonts.Helvetica);
  const characterSet = new Set(font.getCharacterSet());
  const fontResource = "AVBFlightPlanHelvetica";
  const dr = form.acroForm.dict.lookupMaybe(PDFName.of("DR"), PDFDict) ?? document.context.obj({});
  const fonts = dr.lookupMaybe(PDFName.of("Font"), PDFDict) ?? document.context.obj({});
  if (fonts.has(PDFName.of(fontResource))) throw new Error("Collision de ressource du plan de vol Maroc.");
  fonts.set(PDFName.of(fontResource), font.ref);
  dr.set(PDFName.of("Font"), fonts); form.acroForm.dict.set(PDFName.of("DR"), dr);
  const names = new Set<string>();
  for (let i = 0; i < annotations.size(); i++) {
    const ref = annotations.get(i);
    if (!(ref instanceof PDFRef)) throw new Error("Référence de champ du plan de vol invalide.");
    const widget = document.context.lookup(ref, PDFDict);
    const rawName = widget.lookup(PDFName.of("T"));
    const name = rawName instanceof PDFString || rawName instanceof PDFHexString ? rawName.decodeText() : "";
    if (!MOROCCO_FLIGHT_PLAN_FIELDS.includes(name as typeof MOROCCO_FLIGHT_PLAN_FIELDS[number]) || names.has(name) ||
      widget.has(PDFName.of("Parent")) || widget.get(PDFName.of("FT")) !== PDFName.of("Tx")) throw new Error("Structure AcroForm inattendue dans le plan de vol.");
    names.add(name);
    widget.set(PDFName.of("T"), PDFHexString.fromText(`${MOROCCO_FLIGHT_PLAN_PREFIX}${name}`));
    widget.set(PDFName.of("P"), page.ref);
    widget.delete(PDFName.of("AA")); widget.delete(PDFName.of("A")); // No actions or scripts imported.
    form.acroForm.addField(ref); // The source is a flat 29-field tree, each field merged with its widget.
    const field = form.getTextField(`${MOROCCO_FLIGHT_PLAN_PREFIX}${name}`);
    let value = values[name as typeof MOROCCO_FLIGHT_PLAN_FIELDS[number]] ?? field.getText() ?? "";
    if (name === "18") {
      const utc = moroccoFlightPlanUtc(input.dossier.startedAt);
      if (utc) value = value.replace(/DOF\/(?:\d{6})?\s*(?=[A-Z]{2,}\/|$)/, `DOF/${utc.date} `);
      const registration = input.dossier.balloon.registration?.trim();
      if (registration && /^[a-z0-9-]+$/i.test(registration)) value = value.replace(/REG\/[a-z0-9-]+/i, `REG/${registration.replaceAll("-", "").toUpperCase()}`);
    }
    field.disableReadOnly(); field.enableExporting();
    // Keep canonical Unicode intact. Standard Helvetica appearances use visible escapes for
    // unsupported glyphs, matching the existing dossier's fallback rather than losing a name.
    const appearanceValue = Array.from(value).map(c => characterSet.has(c.codePointAt(0)!) ? c : `U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`).join("");
    field.setText(appearanceValue);
    field.acroField.dict.set(PDFName.of("DV"), PDFHexString.fromText(value));
    field.acroField.dict.set(PDFName.of("TU"), PDFHexString.fromText(name === "13t" ? "EOBT UTC HHMM — départ daté et fuseau explicite requis ; à valider avant dépôt" : name === "P" ? "Personnes à bord : passagers + équipage à bord documenté, hors équipe au sol" : `Plan de vol ${name} — modèle de travail non officiel, à valider avant dépôt`));
    const rectangle = field.acroField.getWidgets()[0].getRectangle();
    field.setFontSize(appearanceValue ? Math.min(10, (rectangle.width - 6) / Math.max(1, font.widthOfTextAtSize(appearanceValue, 1))) : 10);
    field.updateAppearances(font);
    field.acroField.setValue(PDFHexString.fromText(value));
    field.acroField.setDefaultAppearance(field.acroField.getDefaultAppearance()!.replace(/\/Helvetica(?=\s)/g, `/${fontResource}`));
    for (const imported of field.acroField.getWidgets()) imported.dict.set(PDFName.of("DA"), PDFString.of(field.acroField.getDefaultAppearance()!));
  }
  return page;
}

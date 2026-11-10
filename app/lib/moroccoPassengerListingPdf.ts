import { PDFDocument, PDFDict, PDFHexString, PDFName, PDFString, StandardFonts, rgb, type PDFPage } from "pdf-lib";
import { moroccoPassengerListingBase64 } from "./moroccoPassengerListingAsset.ts";
import { prepareMoroccoPassengers, type MoroccoPassenger } from "./moroccoPassengers.ts";

/** Append only after the existing dossier is finished: its pages, fields and numbering are untouched. */
export async function prependMoroccoPassengerListing(document: PDFDocument, date: string, passengers?: readonly MoroccoPassenger[]) {
  const rows = prepareMoroccoPassengers(passengers);
  const original = await PDFDocument.load(moroccoPassengerListingBase64);
  if (original.getPageCount() !== 1) throw new Error("Le listing AVB doit comporter une page.");
  const [page] = await document.copyPages(original, [0]);
  // The source tag indices belong to its own structure tree, not the checklist’s.
  // Reusing them causes PDFKit/Safari to omit table headings and row numbers.
  page.node.delete(PDFName.of("StructParents"));
  document.insertPage(0, page);
  const form = document.getForm();
  const font = await document.embedFont(StandardFonts.Helvetica);
  // Resolve the editable fields' /DA font in PDFKit as well as their appearance streams.
  const resources = form.acroForm.dict.lookupMaybe(PDFName.of("DR"), PDFDict) ?? document.context.obj({});
  const fonts = resources.lookupMaybe(PDFName.of("Font"), PDFDict) ?? document.context.obj({});
  fonts.set(PDFName.of(font.name), font.ref);
  resources.set(PDFName.of("Font"), fonts);
  form.acroForm.dict.set(PDFName.of("DR"), resources);
  const text = (name: string, label: string, value: string, x: number, y: number, width: number, height = 29, onPage: PDFPage = page) => {
    const field = form.createTextField(name);
    field.acroField.dict.set(PDFName.of("TU"), PDFHexString.fromText(label));
    field.setText(value);
    if (name.endsWith("-nationalite")) field.enableMultiline();
    field.addToPage(onPage, { x, y, width, height, borderWidth: 0, backgroundColor: rgb(1, 1, 1), textColor: rgb(0, 0, 0), font });
    // Fit full names/nationalities into their original cells without truncation.
    const inset = name.endsWith("-nationalite") ? 14 : 4; // Keep additional padding for native PDF editors in narrow cells.
    field.setFontSize(value ? Math.min(11, (width - inset) / Math.max(1, font.widthOfTextAtSize(value, 1))) : 11);
    field.updateAppearances(font);
    for (const widget of field.acroField.getWidgets()) widget.dict.set(PDFName.of("DA"), PDFString.of(field.acroField.getDefaultAppearance()!));
  };
  text("pax-date", "Date du dossier", date, 460, 742, 100, 19);
  rows.forEach((row, index) => {
    const prefix = `pax-${index + 1}`;
    const y = 599 - index * 39.0147;
    text(`${prefix}-nom`, `Passager ${index + 1} · Nom`, row.lastName, 62, y, 165);
    text(`${prefix}-prenom`, `Passager ${index + 1} · Prénom`, row.firstName, 233, y, 167);
    text(`${prefix}-nationalite`, `Passager ${index + 1} · Nationalité`, row.nationality, 514, y, 48);
    const sex = form.createDropdown(`${prefix}-sexe`);
    sex.acroField.dict.set(PDFName.of("TU"), PDFHexString.fromText(`Passager ${index + 1} · Sexe H/F/E`));
    sex.addOptions(["", "H", "F", "E"]);
    sex.select(row.sex);
    sex.addToPage(page, { x: 406, y, width: 50, height: 29, borderWidth: 0, backgroundColor: rgb(1, 1, 1), textColor: rgb(0, 0, 0), font });
    sex.setFontSize(11);
    sex.updateAppearances(font);
    for (const widget of sex.acroField.getWidgets()) widget.dict.set(PDFName.of("DA"), PDFString.of(sex.acroField.getDefaultAppearance()!));
    text(`${prefix}-poids`, `Passager ${index + 1} · Poids calculé ou personnalisé avant export, conservé si le sexe est changé dans le PDF`, row.weightKg === null ? "" : `${String(row.weightKg).replace(".", ",")} kg`, 462, y, 46);
  });
  // Real AcroForm widgets and appearance streams; no scripts, flattening or viewer calculations.
}

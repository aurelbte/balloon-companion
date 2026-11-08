import { PDFName, PDFHexString, rgb, type PDFDocument } from "pdf-lib";

// Coordinates in source pixels before its outer 0.24 scale / vertical flip.
// Keep each source verification, including equipment a-i, independently editable.
export const MOROCCO_CHECKLIST_GROUPS = [
  { page: 0, name: "enveloppe", x: 75, rows: [554.8, 660.5, 766.1, 871.2, 1079.8, 1293.6, 1398.6, 1497.9, 1594.8] },
  { page: 0, name: "bruleur-carburant", x: 75, rows: [1863.7, 1969.9, 2080.7, 2190.2, 2295.3, 2511.2, 2633.2] },
  { page: 0, name: "nacelle", x: 72, rows: [2912.7, 3018.3, 3124.3, 3237.4] },
  { page: 1, name: "carburant", x: 69, rows: [542.3] },
  { page: 1, name: "equipements", x: 69, rows: [757.9] },
  { page: 1, name: "equipements-detail", x: 75, rows: [846.6, 943.5, 1046.6, 1146.7, 1249.8, 1338.8, 1407.5, 1491.9, 1574.8] },
  { page: 1, name: "passagers", x: 69, rows: [1908.3, 2013.4] },
  { page: 1, name: "chargement", x: 73, rows: [2319.5, 2425.1] },
  { page: 1, name: "harnais", x: 85, rows: [2761.1] },
  { page: 1, name: "conditions-generales", x: 85, rows: [2972.5, 3078.1, 3192.6] },
] as const;

export function addMoroccoChecklistFields(document: PDFDocument) {
  if (document.getPageCount() !== 2) throw new Error("La checklist AVB doit comporter deux pages.");
  const form = document.getForm();
  for (const group of MOROCCO_CHECKLIST_GROUPS) {
    group.rows.forEach((baseline, index) => {
      const field = form.createCheckBox(`avb-${group.name}-${index + 1}`);
      field.acroField.dict.set(PDFName.of("TU"), PDFHexString.fromText(`${group.name} - vérification ${index + 1}`));
      const page = document.getPage(group.page);
      const y = 850.07996 - baseline * .24 - 1;
      // Cover the printed square so a single interactive box remains visible.
      page.drawRectangle({ x: group.x - 2, y: y - 3, width: 10, height: 13, color: rgb(1, 1, 1) });
      field.addToPage(page, {
        x: group.x, y,
        width: 7, height: 7, borderWidth: .6,
        borderColor: rgb(.3, .3, .3), backgroundColor: rgb(1, 1, 1), textColor: rgb(0, 0, 0),
      });
      field.uncheck();
    });
  }
  // Explicit /Off and /Yes appearance streams; no network, JS or flattening.
  form.updateFieldAppearances();
}

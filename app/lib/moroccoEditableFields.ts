import { PDFDict, PDFHexString, PDFName, PDFString, rgb, type PDFDocument, type PDFFont, type PDFPage, type Color } from "pdf-lib";

/** Plain AcroForm only: values remain independent, without calculation actions or PDF JavaScript. */
export function addMoroccoEditableText(document: PDFDocument, page: PDFPage, font: PDFFont, options: {
  name: string; label: string; value: string; x: number; y: number; width: number; height: number; size?: number; multiline?: boolean; color?: Color;
}) {
  const form = document.getForm();
  const resources = form.acroForm.dict.lookupMaybe(PDFName.of("DR"), PDFDict) ?? document.context.obj({});
  const fonts = resources.lookupMaybe(PDFName.of("Font"), PDFDict) ?? document.context.obj({});
  fonts.set(PDFName.of(font.name), font.ref);
  resources.set(PDFName.of("Font"), fonts);
  form.acroForm.dict.set(PDFName.of("DR"), resources);
  const field = form.createTextField(options.name);
  field.acroField.dict.set(PDFName.of("TU"), PDFHexString.fromText(`${options.label} — correction manuelle indépendante, sans recalcul`));
  if (options.multiline) field.enableMultiline();
  field.setText(options.value);
  // Preserve the initial value as the native form default, independently of later edits.
  field.acroField.dict.set(PDFName.of("DV"), PDFHexString.fromText(options.value));
  field.addToPage(page, { x: options.x, y: options.y, width: options.width, height: options.height,
    borderWidth: 0, textColor: options.color ?? rgb(.08, .15, .23), font });
  field.setFontSize(options.size ?? 9);
  field.updateAppearances(font);
  for (const widget of field.acroField.getWidgets()) widget.dict.set(PDFName.of("DA"), PDFString.of(field.acroField.getDefaultAppearance()!));
  return field;
}

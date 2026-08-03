export type ApplicableMtomOption = Readonly<{
  id: string;
  label: string;
  mtomKg: number;
  applicability: string;
  sourceDocument: string;
  manualRevision: string;
  sourcePage: string;
  verificationStatus: "VERIFIED_FROM_OFFICIAL_MANUAL";
}>;

export type ApplicableMtomCatalogEntry = Readonly<{
  manufacturer: "Cameron" | "Kubíček" | "Ultramagic";
  model: string;
  options: readonly ApplicableMtomOption[];
  aircraftSpecificReducedLimitPossible?: boolean;
}>;

const option = (
  id: string,
  label: string,
  mtomKg: number,
  applicability: string,
  sourceDocument: string,
  manualRevision: string,
  sourcePage: string,
): ApplicableMtomOption => Object.freeze({ id, label, mtomKg, applicability, sourceDocument, manualRevision, sourcePage, verificationStatus: "VERIFIED_FROM_OFFICIAL_MANUAL" });

const cameronLimits: readonly [string, number, number][] = [
  ["Z90", 816, 499], ["Z105", 952, 952], ["Z120", 1_088, 999], ["Z133", 1_206, 999],
  ["Z150", 1_361, 999], ["Z160", 1_451, 999], ["Z180", 1_633, 999], ["Z210", 1_905, 999],
  ["Z250", 2_268, 1_999], ["Z350", 3_175, 2_699], ["Z425LW", 3_662, 2_699],
];

const cameronEntries = cameronLimits.map(([model, standard, reduced]): ApplicableMtomCatalogEntry => ({
  manufacturer: "Cameron",
  model,
  options: standard === reduced
    ? [option(`${model}-MTOM`, "MTOM applicable", standard, "Standard MTOM et Reduced MTOM identiques pour cette variante", "Cameron Hot Air Balloon Flight Manual", "Issue 10 Amendment 18", model === "Z425LW" ? "2-7" : "2-6")]
    : [
      option(`${model}-STANDARD`, "Standard MTOM", standard, "Variante et configuration correspondant à la Standard MTOM", "Cameron Hot Air Balloon Flight Manual", "Issue 10 Amendment 18", model === "Z250" || model === "Z350" || model === "Z425LW" ? "2-7" : "2-6"),
      option(`${model}-REDUCED`, "Reduced MTOM", reduced, "Reduced MTOM inscrite pour l'aéronef applicable", "Cameron Hot Air Balloon Flight Manual", "Issue 10 Amendment 18", model === "Z250" || model === "Z350" || model === "Z425LW" ? "2-7" : "2-6"),
    ],
}));

const kubicekMtow: Readonly<Record<string, number>> = {
  BB9E: 295, BB12E: 385, BB16E: 470, BB18E: 550, BB20E: 630, BB22E: 680, BB26E: 730, BB30E: 840, BB34E: 945,
  BB20ED: 630, BB22ED: 680, BB26ED: 730, BB30ED: 840, BB34ED: 945, BB9EF: 295, BB12EF: 385, BB16EF: 470,
  BB22M: 680, BB26M: 730, BB30M: 840, BB22Z: 730, BB26Z: 840, BB30Z: 945, BB34Z: 1_040, BB37Z: 1_150,
  BB40Z: 1_310, BB42Z: 1_410, BB45Z: 1_520, BB51Z: 1_690, BB60Z: 1_940, BB64Z: 2_100, BB70Z: 2_300,
  BB78Z: 2_600, BB85Z: 2_820, BB92Z: 3_000, BB100Z: 3_200, BB22D: 730, BB26D: 840, BB30D: 945,
  BB34D: 1_040, BB40D: 1_310, BB105P: 3_500, BB106P: 3_500, BB113P: 3_600, BB120P: 3_700,
  BB130P: 4_200, BB142P: 4_500, BB150P: 4_800, BB184P: 5_095, BB14XR: 420, BB16XR: 470,
  BB17XR: 495, BB18XR: 570, BB20XR: 730, BB22XR: 780, BB26XR: 840, BB30XR: 945,
};

const kubicekEntries = Object.entries(kubicekMtow).map(([model, mtowKg]): ApplicableMtomCatalogEntry => ({
  manufacturer: "Kubíček",
  model,
  options: [option(`${model}-MTOW`, "MTOW du modèle", mtowKg, "Sous réserve de la RMTOW inscrite page II pour l'aéronef", "Kubíček Flight Manual B.3102", "Edition 3 Revision 22", "2-5")],
  aircraftSpecificReducedLimitPossible: true,
}));

const ultramagicLimits: Readonly<Record<string, readonly [number, number]>> = {
  H31: [307, 295], H42: [416, 399], H56: [549, 532], H65: [638, 618], H77: [756, 732],
  S90: [878, 855], S105: [1_032, 998], S130: [1_365, 1_235], S160: [1_569, 1_506],
  V25: [250, 238], V56: [549, 532], V65: [638, 618], V77: [756, 732], V90: [878, 855], V105: [1_032, 998],
  M42: [414, 399], M56: [550, 532], M56C: [550, 532], M65: [638, 618], M65C: [635, 618],
  M77: [756, 732], M77C: [756, 732], M90: [880, 855], M105: [1_032, 998], M120: [1_173, 1_140],
  M130: [1_365, 1_235], M145: [1_436, 1_378], M160: [1_569, 1_506], M56Z: [549, 531],
  M60Z: [588, 568], M65Z: [636, 615], M70Z: [686, 663], M74Z: [710, 687],
  N180: [1_754, 1_710], N210: [2_064, 1_995], N250: [2_408, 2_375], N300: [2_924, 2_845],
  N355: [3_450, 3_373], N370: [3_450, 3_370], N390: [3_795, 3_552], N415: [3_950, 3_780],
  N425: [4_140, 3_995], N450: [4_140, 3_995], N500: [5_000, 3_995], N550: [5_000, 4_100],
  Z90: [894, 855], G90: [878, 855], T150: [1_465, 1_425], T180: [1_754, 1_710], T210: [2_070, 1_995],
};

const ultramagicEntries = Object.entries(ultramagicLimits).map(([model, [standard, reduced]]): ApplicableMtomCatalogEntry => ({
  manufacturer: "Ultramagic",
  model,
  options: [
    option(`${model}-MAXIMUM`, "Maximum TOM", standard, "Maximum TOM de la variante indiquée", "Ultramagic Hot Air Balloon Flight Manual FM04", "Revision 30", standard <= 638 ? "5.7" : "5.8"),
    option(`${model}-REDUCED`, "Reduced MTOM", reduced, "Uniquement si la limite réduite est enregistrée dans le carnet du ballon", "Ultramagic Hot Air Balloon Flight Manual FM04", "Revision 30", "5.8-5.9"),
  ],
}));

export const applicableMtomCatalog = Object.freeze([
  ...cameronEntries,
  ...kubicekEntries,
  ...ultramagicEntries,
] as readonly ApplicableMtomCatalogEntry[]);

function normalize(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

export function applicableMtomCatalogEntry(manufacturer: string, model: string): ApplicableMtomCatalogEntry | null {
  return applicableMtomCatalog.find((entry) => normalize(entry.manufacturer) === normalize(manufacturer) && normalize(entry.model) === normalize(model)) ?? null;
}

export function proposedApplicableMtowKg(manufacturer: string, model: string): number | null {
  const entry = applicableMtomCatalogEntry(manufacturer, model);
  if (!entry || entry.aircraftSpecificReducedLimitPossible || entry.options.length !== 1) return null;
  return entry.options[0].mtomKg;
}

export function resolveApplicableMtowSuggestion(currentValueKg: number | undefined, manufacturer: string, model: string): Readonly<{ valueKg: number | undefined; proposed: boolean }> {
  if (currentValueKg !== undefined) return { valueKg: currentValueKg, proposed: false };
  const proposal = proposedApplicableMtowKg(manufacturer, model);
  return proposal === null ? { valueKg: undefined, proposed: false } : { valueKg: proposal, proposed: true };
}

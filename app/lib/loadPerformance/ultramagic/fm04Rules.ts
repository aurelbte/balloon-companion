/** Transcription of the local FM04 Rev30 PDF, SHA-256
 * b6f45b47fce6c7ff74802a260fa03459d8b38f967a5ef1f396132e004374deab.
 * Page revisions are those printed in the approved effective-page list.
 * These documentary rules do not activate or validate the lift method. */
export type Fm04Source = Readonly<{ manualRevision: "FM04_REVISION_30"; page: string; pageRevision: number }>;
export const fm04Source = (page: string, pageRevision: number): Fm04Source => ({ manualRevision: "FM04_REVISION_30", page, pageRevision });
export const normalizeFm04Identifier = (value: string | undefined): string => typeof value === "string" ? value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase() : "";
export type MinimumTomRule = Readonly<
  | { state: "NUMERIC"; kg: number; source: Fm04Source; landingSource?: Fm04Source }
  | { state: "NOT_APPLICABLE" | "NOT_INDICATED"; source: Fm04Source }
>;
const minimums: Record<string, MinimumTomRule> = {};
function minimum(models: string, rule: MinimumTomRule) { for (const model of models.split(" ")) minimums[model] = rule; }
minimum("V25 H31 H42 M42", { state: "NOT_APPLICABLE", source: fm04Source("5.7", 30) });
// The 56k/65k cells explicitly restrict their numeric minima to the MZ variants.
minimum("H56 V56 M56 M56C H65 V65 M65 M65C", { state: "NOT_INDICATED", source: fm04Source("5.7", 30) });
minimum("H77 V77 M77 M77C S90 V90 M90 Z90 G90", { state: "NOT_APPLICABLE", source: fm04Source("5.8", 29) });
for (const [model, kg] of [["M56Z", 297], ["M60Z", 299], ["M65Z", 303]] as const) minimum(model, { state: "NUMERIC", kg, source: fm04Source("5.7", 30) });
for (const [model, kg] of [["M70Z", 306], ["M74Z", 312]] as const) minimum(model, { state: "NUMERIC", kg, source: fm04Source("5.8", 29) });
// Landing requirement is explicit in 2.6, p.2.3 Rev27 for volumes >90,000 ft³.
for (const [models, kg] of [
  ["S105 V105 M105", 480], ["M120", 544], ["S130 M130", 588], ["M145", 656],
  ["T150", 679], ["S160 M160", 728], ["T180 N180", 816], ["T210 N210", 960],
  ["N250", 1120], ["N300", 1360], ["N355 N370", 1600], ["N390", 1760],
  ["N415", 1805], ["N425 N450", 1920], ["N500", 2300], ["N550", 2500],
] as const) minimum(models, { state: "NUMERIC", kg, source: fm04Source("5.8", 29), landingSource: fm04Source("2.3", 27) });
export function fm04MinimumTom(model: string): MinimumTomRule | undefined { return minimums[normalizeFm04Identifier(model)]; }

const basketDefaults: Readonly<Record<string, number>> = {
  C0: 258, C1: 1032, C2: 756, C3: 1365, C4: 1569, C5: 1569, C6: 1076,
  C7: 1288, C8: 1794, C9: 2208, C10: 1000, C11: 2680, C12: 3000, C14: 5000, C15: 5000,
};
/** Plate has priority. C13 is not documented; no value is interpolated. */
export function fm04BasketDefault(type: string) {
  const kg = basketDefaults[normalizeFm04Identifier(type)];
  return kg === undefined ? { state: "NOT_DOCUMENTED" as const, source: fm04Source("5.9", 27) }
    : { state: "NUMERIC" as const, kg, source: fm04Source("5.9", 27) };
}
export type Fm04Compatibility = Readonly<{ baskets: readonly string[]; burners: readonly string[]; source: Fm04Source }>;
const compatibility: Record<string, Fm04Compatibility> = {};
function row(models: string, baskets: string, burners: readonly string[], page: "5.6" | "5.7") {
  for (const model of models.split(" ")) compatibility[model] = {
    baskets: baskets ? baskets.split(" ") : [], burners: burners.map(normalizeFm04Identifier),
    source: fm04Source(page, page === "5.6" ? 27 : 30),
  };
}
// Only shaded cells, not the orientative Pv/Lmax tables on 5.1–5.2.
const a = ["MK-2 Single", "MK-10 Single", "MK-21 Single", "BMK-008 Single", "MK-2 Double", "MK-10 Double", "MK-21 Double", "BMK-008 Double", "MK-32 Double"];
row("V25", "", a.slice(2, 4), "5.6"); // SOLO appears in 5.1, not as a C-basket column in 5.6.
row("H31", "C0 C2", a.slice(0, 4), "5.6");
row("H42", "C0 C2 C1", a.slice(0, 4), "5.6");
row("M42", "C0 C2 C1", a.slice(1, 4), "5.6");
row("H56 V56 M56 M56C", "C0 C2 C1", a, "5.6");
row("H65 V65", "C2 C1 C3 C10", a, "5.6");
row("M65 M65C H77 V77 M77 M77C", "C2 C1 C3 C10 C4", a, "5.6");
row("S90 M90 Z90", "C2 C1 C3 C10 C4", a.slice(2), "5.6");
row("V90", "C2 C1 C3 C10 C4", a.slice(3), "5.6");
const b = ["MK-21 Single", "BMK-008 Single", "MK-2 Double", "MK-10 Double", "MK-21 Double", "BMK-008 Double", "MK-32 Double", "MK-2 Triple", "MK-10 Triple", "MK-21 Triple", "MK-32 Triple"];
row("S105", "C1 C3 C10 C4", b.slice(0, 7), "5.6");
row("V105", "C1 C3 C10 C4", b.slice(1, 10), "5.6");
row("M105", "C1 C3 C10 C4", b.slice(0, 10), "5.6");
row("M120", "C1 C3 C10 C4 C6 C7 C5", b.slice(1), "5.6");
row("S130 M130", "C1 C3 C10 C4 C6 C7 C5", b.slice(2), "5.6");
row("M145", "C3 C10 C4 C6 C7 C5", b.slice(2), "5.6");
row("T150", "C3 C10 C4 C6 C7 C5", b.slice(2).filter((burner) => burner !== "MK-2 Triple"), "5.6");
row("S160 M160", "C10 C4 C6 C7 C5", b.slice(2), "5.6");
const c = ["MK-10 Double", "MK-21 Double", "BMK-008 Double", "MK-32 Double", "MK-2 Triple", "MK-10 Triple", "BMK-050 Double", "MK-21 Triple", "MK-32 Triple", "MK-2 Quad", "MK-10 Quad", "BMK-050 Triple", "MK-21 Quad", "MK-32 Quad"];
row("T180 N180", "C6 C7 C5 C8 C9", [...c.slice(0, 11), c[13]], "5.7");
row("T210 N210", "C6 C7 C5 C8 C9 C11", [...c.slice(1, 4), ...c.slice(5, 11), c[13]], "5.7");
row("N250", "C7 C5 C8 C9 C11", [...c.slice(6, 12), c[13]], "5.7");
row("N300", "C5 C8 C9 C11 C12", c.slice(6), "5.7");
const d = ["MK-2 Quad", "MK-10 Quad", "BMK-050 Triple", "MK-21 Quad", "MK-32 Quad", "BMK-050 Quad"];
row("N355", "C5 C8 C9 C11 C12", d, "5.7");
row("N370 N390", "C5 C8 C9 C11 C12", d.slice(2), "5.7");
row("N415", "C5 C8 C9 C11 C12 C14", d.slice(2), "5.7");
row("N425", "C5 C8 C9 C11 C12 C14", d, "5.7");
row("N450", "C5 C8 C9 C11 C12 C14", d.slice(2), "5.7");
row("N500 N550", "C11 C12 C14 C15", d.slice(3), "5.7");
// G90 and MZ have no row in these matrices. Never alias them to neighbouring models.
export function fm04Compatibility(model: string): Fm04Compatibility | undefined { return compatibility[normalizeFm04Identifier(model)]; }

export function fm04BurnerDocumented(burner: string): boolean {
  const normalized = normalizeFm04Identifier(burner);
  return Object.values(compatibility).some((row) => row.burners.includes(normalized));
}

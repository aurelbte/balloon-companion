import { cameronDocumentedCatalogModels } from "./cameronCatalog.ts";
import { ultramagicModelParameters } from "./loadPerformance/modelParameters/ultramagicModels.ts";
import { fm04MinimumTom } from "./loadPerformance/ultramagic/fm04Rules.ts";

/** PDF presentation data only. Does not enable or modify a load calculation method. */
export type MoroccoLandingMassRule = Readonly<{
  manufacturer: "Cameron" | "Ultramagic";
  model: string;
  variant: string;
  volumeM3: number;
  value: number;
  unit: "kg";
  source: Readonly<{
    file: string; sha256: string; edition: string; sections: string;
    pages: readonly string[]; pdfPages: readonly number[];
  }>;
  conditions: readonly string[];
}>;

const cameronConditions = [
  "Exploitation normale uniquement (§2.9.3) ; pas de vol spécial ni tentative de record (§2.9.4).",
  "Type et variante de l’enveloppe conformes à la page i-i ; configuration applicable vérifiée.",
  "Suppléments et données approuvées examinés : aucune disposition modifiant cette MLM (§8.1/8.3).",
] as const;

// Exact types present in French Table 5, pp.9-1..9-3, with a numeric Table 1 MLM.
// No alias from volume alone: A-340 and A-340HL, LW and standard remain distinct.
const frenchTypes = new Set((
  "A105 A120 A140 A160 A180 A200 A210 A250 A275 A300 A315 A340 A340HL A375 A400 A415 A450LW A530LW A530 " +
  "N105 N120 N133 N145 N160 N180 N210 O105 O120 O140 O160 " +
  "Z120 Z133 Z140 Z145 Z150 Z160 Z180 Z210 Z225 Z250 Z275 Z315 Z350 Z375 Z400 Z425LW Z450 Z600 Z750"
).split(" "));
const cameron = cameronDocumentedCatalogModels.filter(row => row.documentation.minimumLandingMassKg !== null);
const englishRules: MoroccoLandingMassRule[] = cameron.map(row => ({
  manufacturer: "Cameron", model: row.model, variant: row.model.replace(/^(Sport|TR|[ACNOZ])/, ""), volumeM3: row.volumeM3,
  value: row.documentation.minimumLandingMassKg!, unit: "kg",
  source: {
    file: ".load-performance-work/manuals/cameron-amendment-18.pdf",
    sha256: "a2bb81dd8cff59771381a580812ce6e9878c74b0c0aa450981c219abba1b8572",
    edition: "Issue 10, Amendment 18 (05 July 2022)", sections: "2.9.3/2.9.4, Table 2 ; 8.1/8.3 ; Table 5",
    pages: ["2-4 (A17)", `${row.documentation.limitsPage} (A18)`, row.documentation.equipmentPage, "8-1/8-2"],
    pdfPages: [26, row.documentation.limitsPage === "2-6" ? 28 : 29, row.documentation.equipmentPage === "9-1" ? 83 : row.documentation.equipmentPage === "9-2" ? 84 : 85, 81, 82],
  }, conditions: cameronConditions,
}));
const frenchRules: MoroccoLandingMassRule[] = cameron.filter(row => frenchTypes.has(row.model)).map(row => {
  const firstPage = row.documentation.volumeCuFt <= 340000 && !row.model.endsWith("340HL");
  return {
    manufacturer: "Cameron", model: row.model, variant: row.model.replace(/^[ANOZ]/, ""), volumeM3: row.volumeM3,
    // Numeric kg cells checked against the French Table 1, not calculated from MTOM or pounds.
    value: row.documentation.minimumLandingMassKg!, unit: "kg",
    source: {
      file: "Manuel-de-Vol-Actuel-FR.pdf", sha256: "38b5155771e4ed464754c06f23501b6f545f57cd0e2bec70f7e86d988b324fa6",
      edition: "Édition 10, amendement 12 (registre du 03 mai 2013)", sections: "2.9.3/2.9.4, tableau 1 ; 8.1/8.3 ; tableau 5",
      pages: ["2-4 (A12)", `${firstPage ? "2-6" : "2-7"} (A12)`, row.model.startsWith("A") ? "9-1" : row.model.startsWith("Z") ? "9-3" : "9-2", "8-1/8-2"],
      pdfPages: [22, firstPage ? 24 : 25, row.model.startsWith("A") ? 79 : row.model.startsWith("Z") ? 81 : 80, 77, 78],
    }, conditions: cameronConditions,
  };
});
const ultramagicRules: MoroccoLandingMassRule[] = ultramagicModelParameters.flatMap(row => {
  const rule = fm04MinimumTom(row.model);
  // Small MZ numeric takeoff minima are not landing minima: §2.6 explicitly requires >90,000 ft³.
  if (rule?.state !== "NUMERIC" || !rule.landingSource || row.volumeM3 === undefined) return [];
  return [{
    manufacturer: "Ultramagic", model: row.model, variant: row.model, volumeM3: row.volumeM3, value: rule.kg, unit: "kg",
    source: {
      file: "MV04ar30.pdf", sha256: "b6f45b47fce6c7ff74802a260fa03459d8b38f967a5ef1f396132e004374deab",
      edition: "FM04 Rev.30 (21 July 2025), pages 2.3 Rev.27 / 5.8 Rev.29",
      sections: "2.6 Loading ; 5.5 Minimum Take off Mass ; Build Standard 0.1/0.2",
      pages: ["2.3 (Rev.27)", "5.8 (Rev.29)", "0.1/0.2"], pdfPages: [15, 47, 2, 3],
    }, conditions: [
      "Volume supérieur à 90 000 ft³ : application à l’atterrissage explicitement prescrite par §2.6.",
      "Modèle, volume et configuration conformes au Build Standard signé et aux suppléments applicables ; aucune dérogation MLM.",
      "Valeur de la colonne Minimum TOM de §5.5 ; ne pas confondre avec le R.MTOM de §5.6.",
    ],
  }];
});
export const MOROCCO_LANDING_MASS_RULES: readonly MoroccoLandingMassRule[] = [...englishRules, ...frenchRules, ...ultramagicRules];

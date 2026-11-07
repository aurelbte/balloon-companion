/** Documentary/candidate data only. No validated production dataset or activation. */
export const kubicekB3102Ed3Rev23Rows = [] as const;
export const kubicekB3102Ed3Rev23Source = {
  manualId: "KUBICEK_B3102_ED3_REV23",
  manualRevision: "Edition 3 Revision 23 — 24 July 2026",
  evidenceRevision: "B3102_ED3_REV23",
  sourceUrl: "https://uvdtwqqskniekkkbnahm.supabase.co/storage/v1/object/public/product-images/manuels/kubicek-manuel-de-vol-B3102-rev23.pdf",
  sha256: "acf9540b314a9060b68c8006c76ad7790a8eaf97bf695f59c9f84bac11ab2410",
  pageRevisions: {
    "II": 23, "2-4": 23, "2-5": 23, "2-6": 23, "2-7": 5,
    "2-8": 23, "2-9": 23, "2-10": 23, "2-11": 23,
    "5-1": 0, "5-2": 16, "5-3": 17, "5-4": 23, "5-5": 23,
    "8-1": 23, "8-2": 22, "8-3": 23, "8-5": 23,
  },
  loadingTableUnit: "kg",
  loadingChartChanged: false,
  // p.5-5 is not used by the engine: do not inject pound values into kg rows.
  unusedPoundTableCorrection: { models: ["BB16","BB16E","BB16EF","BB16XR"], liftUnits: [19,20,21,22,23], valueLb: 1035 },
} as const;

/** p.5-4 Rev.23, PDF p.70, visually checked before transcription. Never regenerate from volume. */
export const kubicekOrigo15LoadingTableKg = [250,275,301,326,351,376,401,426,450,450,450,450,450,450] as const;
/** p.2-4 Rev.23 §2.8; does not replace or recalibrate the unchanged LU chart. */
export const KUBICEK_MAXIMUM_ENVELOPE_TEMPERATURE_C = 124;

/** Only these exact changed rows are transcribed. Missing rows remain subject to documentary review. */
const smallBaskets = ["K7","ORIGO","K10S","K10C","K10","K11","K12","K12A","K13","K13S","K13C"] as const;
export type KubicekRev23Compatibility = Readonly<{
  basketPage?: string; baskets?: readonly string[]; rotationVentBaskets?: readonly string[];
  burnerPage: "2-11"; burnerRow: readonly string[]; burners: readonly string[];
  ignisTwoUnitsMinimumSerial?: number;
}>;
export const kubicekRev23CompatibilityRows: Readonly<Record<string, KubicekRev23Compatibility>> = {
  "Origo 15": {
    basketPage:"2-8", baskets:smallBaskets, rotationVentBaskets:["ORIGO","K10C","K13C"],
    burnerPage:"2-11", burnerRow:["Origo 15"], burners:["KOMET DUO UP TO 104","ORIGO","SIRIUS"],
  },
  "Origo 18": {
    basketPage:"2-9", baskets:[...smallBaskets,"K14","K15","K16","K17","K18","K19","K19L","K22"],
    rotationVentBaskets:["ORIGO","K10C","K13C"],
    burnerPage:"2-11", burnerRow:["Origo 18"], burners:["KOMET DUO UP TO 104","KOMET DUO 105+","ORIGO","SIRIUS","IGNIS - 2 units"],
  },
  BB74Z: { burnerPage:"2-11", burnerRow:["BB74Z"], burners:["IGNIS - 2 units","IGNIS - 3 units","IGNIS - 4 units"], ignisTwoUnitsMinimumSerial:516 },
  BB78Z: { burnerPage:"2-11", burnerRow:["BB78Z"], burners:["IGNIS - 2 units","IGNIS - 3 units","IGNIS - 4 units"], ignisTwoUnitsMinimumSerial:516 },
};
/** p.8-3 / p.8-5 Rev.23: the Origo basket and burner each require the Origo frame. */
export const kubicekOrigoEquipment = {
  basketModel:"ORIGO", burnerModel:"ORIGO", frameModel:"ORIGO",
  basketMaximumCarriedKg:455, maximumOccupants:2,
  frameMaximumVolumeM3:1800, frameMaximumSurfaceWindMs:5.5,
  basketFrameSource:"8-3 Rev.23", burnerFrameSource:"8-5 Rev.23", frameLimitSource:"2-10 Rev.23",
} as const;

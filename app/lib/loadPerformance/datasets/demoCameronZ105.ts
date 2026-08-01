// DONNÉES SYNTHÉTIQUES POUR TEST UX UNIQUEMENT — aucune valeur ne provient d'un manuel constructeur.
export const demoCameronZ105 = {
  id: "DEMO_CAMERON_Z105_UI_TEST",
  authorityStatus: "DEMO_ONLY",
  manufacturer: "Cameron",
  model: "Z105",
  sourceUrl: null,
  manualRevision: null,
  verifiedBy: null,
  official: false,
  extrapolationAllowed: false,
  table: [
    { groundTemperatureC: 0, valuesByAltitude: [{ altitudeMslM: 0, permittedTotalMassKg: 1450 }, { altitudeMslM: 500, permittedTotalMassKg: 1370 }, { altitudeMslM: 1000, permittedTotalMassKg: 1290 }, { altitudeMslM: 1500, permittedTotalMassKg: 1210 }, { altitudeMslM: 2000, permittedTotalMassKg: 1130 }] },
    { groundTemperatureC: 10, valuesByAltitude: [{ altitudeMslM: 0, permittedTotalMassKg: 1370 }, { altitudeMslM: 500, permittedTotalMassKg: 1290 }, { altitudeMslM: 1000, permittedTotalMassKg: 1210 }, { altitudeMslM: 1500, permittedTotalMassKg: 1130 }, { altitudeMslM: 2000, permittedTotalMassKg: 1050 }] },
    { groundTemperatureC: 20, valuesByAltitude: [{ altitudeMslM: 0, permittedTotalMassKg: 1290 }, { altitudeMslM: 500, permittedTotalMassKg: 1210 }, { altitudeMslM: 1000, permittedTotalMassKg: 1130 }, { altitudeMslM: 1500, permittedTotalMassKg: 1050 }, { altitudeMslM: 2000, permittedTotalMassKg: 970 }] },
    { groundTemperatureC: 30, valuesByAltitude: [{ altitudeMslM: 0, permittedTotalMassKg: 1210 }, { altitudeMslM: 500, permittedTotalMassKg: 1130 }, { altitudeMslM: 1000, permittedTotalMassKg: 1050 }, { altitudeMslM: 1500, permittedTotalMassKg: 970 }, { altitudeMslM: 2000, permittedTotalMassKg: 890 }] },
  ],
} as const;

export const enabledDemoLoadDatasets = [demoCameronZ105] as const;

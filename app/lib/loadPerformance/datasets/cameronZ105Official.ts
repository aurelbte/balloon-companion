import { CAMERON_Z105_ACTIVATION_REQUIREMENTS, cameronZ105References } from "../referenceCases/cameronZ105References.ts";

/**
 * Réceptacle auditable du futur dataset Cameron Z105.
 * Les champs numériques restent volontairement absents jusqu'à transcription et double vérification.
 */
export const cameronZ105Official = Object.freeze({
  id: "CAMERON_Z105_OFFICIAL",
  manufacturer: "Cameron",
  model: "Z105",
  authorityStatus: "PENDING_VERIFICATION",
  enabled: false,
  documentedData: {
    loadTable: null,
    applicableConfigurations: null,
    mtomRules: null,
  },
  source: {
    manualTitle: null,
    manualRevision: null,
    sourceUrl: null,
    tablePages: [] as readonly string[],
    sourceFingerprint: null,
  },
  calculationMethod: {
    temperatureRule: null,
    altitudeRule: null,
    interpolationPolicy: null,
    extrapolationAllowed: false,
    toleranceKg: null,
  },
  limitations: [
    "Aucune table numérique officielle complète et vérifiée n'est intégrée.",
    "Aucune méthode d'interpolation constructeur n'est validée.",
    "Le moteur officiel doit rester indisponible.",
  ],
  referenceCaseIds: cameronZ105References.map(({ id }) => id),
  activationRequirements: CAMERON_Z105_ACTIVATION_REQUIREMENTS,
});

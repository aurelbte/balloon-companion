import {
  officialAscensionFlightNature,
  officialAscensionMovementCounts,
  type OfficialAscension,
  type OfficialFlightNature,
} from "./flightCompletion.ts";
import type { QualificationPersonSnapshot } from "./pilotQualifications.ts";

const FLIGHT_NATURE_LABELS: Readonly<Record<OfficialFlightNature, string>> = Object.freeze({
  STANDARD: "Vol standard",
  TRAINING_BPL: "Vol d’entraînement BPL",
  PROFICIENCY_CHECK_BPL: "Contrôle de compétences BPL",
  SKILL_TEST: "Examen pratique",
  COMMERCIAL_TRAINING: "Formation commerciale",
  COMMERCIAL_PROFICIENCY_CHECK: "Contrôle de compétences commercial",
  INSTRUCTION: "Instruction",
});

export function officialAscensionOriginLabel(source: OfficialAscension["source"]): string {
  return source === "MANUAL" ? "Saisie manuelle" : "GPS · Balloon Companion";
}

export function officialAscensionFlightNatureLabel(
  ascension: Pick<OfficialAscension, "flightNature">,
): string {
  return FLIGHT_NATURE_LABELS[officialAscensionFlightNature(ascension)];
}

export function officialAscensionMovementLabels(
  ascension: Pick<OfficialAscension, "takeoffCount" | "landingCount">,
): Readonly<{ takeoffs: string; landings: string }> {
  const movements = officialAscensionMovementCounts(ascension);
  return { takeoffs: String(movements.takeoffs), landings: String(movements.landings) };
}

export function qualificationPersonLabel(person: QualificationPersonSnapshot | undefined): string | null {
  const name = person?.name.trim() ?? "";
  if (!name) return null;
  const licenceNumber = person?.licenceNumber?.trim();
  return licenceNumber ? `${name} · ${licenceNumber}` : name;
}

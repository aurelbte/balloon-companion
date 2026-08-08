import type { OfficialAscension } from "./flightCompletion";

export type OfficialAscensionEditValues = {
  dateIso: string;
  balloonModel: string;
  balloonManufacturer: string;
  registration: string;
  departure: string;
  arrival: string;
  category: OfficialAscension["category"];
  pilotFunction: OfficialAscension["pilotFunction"];
  nightFlight: boolean;
  maximumAltitudeM: string;
  officialDurationMinutes: number;
  observations: string;
};

/** Maps every editable official field without altering measured GPS metadata. */
export function officialAscensionToEditValues(
  ascension: OfficialAscension,
): OfficialAscensionEditValues {
  return {
    dateIso: ascension.dateIso,
    balloonModel: ascension.balloonModel,
    balloonManufacturer: ascension.balloonManufacturer ?? "",
    registration: ascension.registration,
    departure: ascension.departure,
    arrival: ascension.arrival,
    category: ascension.category,
    pilotFunction: ascension.pilotFunction,
    nightFlight: ascension.nightFlight,
    maximumAltitudeM:
      ascension.maximumAltitudeM === null
        ? ""
        : String(ascension.maximumAltitudeM),
    officialDurationMinutes: ascension.officialDurationMinutes,
    observations: ascension.observations,
  };
}

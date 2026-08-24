import { officialAscensionFlightNature, roundJournalAltitudeMeters, type OfficialAscension } from "./flightCompletion.ts";

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
  flightNature: ReturnType<typeof officialAscensionFlightNature>;
  takeoffCount: string;
  landingCount: string;
  instructorName: string;
  instructorLicenceNumber: string;
  examinerName: string;
  examinerLicenceNumber: string;
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
        : String(roundJournalAltitudeMeters(ascension.maximumAltitudeM)),
    officialDurationMinutes: ascension.officialDurationMinutes,
    flightNature: officialAscensionFlightNature(ascension),
    takeoffCount: ascension.takeoffCount === undefined ? "" : String(ascension.takeoffCount),
    landingCount: ascension.landingCount === undefined ? "" : String(ascension.landingCount),
    instructorName: ascension.instructor?.name ?? "",
    instructorLicenceNumber: ascension.instructor?.licenceNumber ?? "",
    examinerName: ascension.examiner?.name ?? "",
    examinerLicenceNumber: ascension.examiner?.licenceNumber ?? "",
    observations: ascension.observations,
  };
}

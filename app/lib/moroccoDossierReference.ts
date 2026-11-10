import { civilDateTimeToIso, isValidTimeZone, zonedDateTimeParts } from "./timeZone.ts";

export type MoroccoDossierReference = Readonly<{ date: string; time: string }>;
export type ResolvedMoroccoDossierReference = MoroccoDossierReference & Readonly<{
  iso: string; timeZone: string; dateLabel: string; offset: string; label: string; warning: string | null;
}>;

/** A document reference only: never retime the flight, forecasts, observations or events. */
export function resolveMoroccoDossierReference(preparation: { startedAt: string; launchTimeZone?: string }, override?: MoroccoDossierReference): ResolvedMoroccoDossierReference {
  const zoneKnown = isValidTimeZone(preparation.launchTimeZone);
  const timeZone = zoneKnown ? preparation.launchTimeZone! : "UTC";
  const initial = zonedDateTimeParts(preparation.startedAt, timeZone);
  if (!initial) throw new Error("Date/heure de préparation invalide pour préremplir le dossier.");
  const reference = override ?? initial;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reference.date) || !/^\d{2}:\d{2}$/.test(reference.time)) throw new Error("Date du dossier : AAAA-MM-JJ ; heure du dossier : HH:mm.");
  // The preparation's ISO instant disambiguates its own civil time at DST fall-back.
  const iso = reference.date === initial.date && reference.time === initial.time
    ? new Date(Math.floor(Date.parse(preparation.startedAt) / 60_000) * 60_000).toISOString() : civilDateTimeToIso(reference.date, reference.time, timeZone);
  if (!iso) throw new Error(`Date/heure du dossier invalide, inexistante ou ambiguë dans le fuseau ${timeZone}.`);
  const [year, month, day] = reference.date.split("-");
  const dateLabel = `${day}/${month}/${year}`;
  const offset = new Intl.DateTimeFormat("fr-FR", { timeZone, timeZoneName: "shortOffset" }).formatToParts(new Date(iso)).find(part => part.type === "timeZoneName")!.value.replace(/\u2212/g, "-").replace(/^UTC[+-]0(?::00)?$/, "UTC");
  return { date: reference.date, time: reference.time, iso, timeZone, dateLabel, offset, label: `${dateLabel} ${reference.time} (${timeZone}, ${offset})`, warning: zoneKnown ? null : "Fuseau local du vol non renseigné : référence affichée en UTC." };
}

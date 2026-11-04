import type { FlightDossierOperations } from "../lib/flightDossierOperations";

export default function FlightDossierOperationsSummary({ data }: { data: FlightDossierOperations }) {
  const load = data.load;
  return <details>
    <summary>Charge et espaces de la stratégie</summary>
    <p>Charge · {load.status === "UNAVAILABLE" ? "Indisponible" : load.calculationStatus === "CANDIDATE_PILOT_VALIDATION" ? "Candidat — validation pilote" : load.calculationStatus === "OFFICIAL_VALIDATED" ? "Validée" : load.calculationStatus === "PENDING_VERIFICATION" ? "En attente de vérification" : "Indisponible"}</p>
    <p>Masse prévue : {load.plannedMassKg === null ? "indisponible" : `${load.plannedMassKg} kg`} · Limite : {load.applicableLimitKg === null ? "indisponible" : `${load.applicableLimitKg} kg`} · Marge : {load.signedMarginKg ?? "indisponible"}</p>
    {load.message && <p>{load.message}</p>}
    <p>Courbe : {load.curve.status === "SOURCE_DATA_AVAILABLE" ? "points source disponibles, sans nouvelle limite calculée" : "indisponible"}.</p>
    {data.airspaces.notices.map((notice) => <p key={notice}>{notice}</p>)}
    {data.airspaces.uncertain.map((item) => <section key={item.airspace.airspaceCompositeKey || item.airspace.airspaceId}>
      <strong>{item.airspace.name} · Classe {item.airspace.icaoClassLabel}</strong>
      <p>{item.floor.displayLabel} → {item.ceiling.displayLabel}</p>
      <p>{item.spatialStatus === "INTERSECTS_3D" ? "Intersection 3D de la trajectoire prévue" : "Intersection verticale incertaine"} · activité indéterminée.</p>
      {item.passages.map((passage, index) => <p key={index}>{passage.entryAt ?? "Horaire inconnu"} → {passage.exitAt ?? "Horaire inconnu"}{passage.reasons.length > 0 && " · Référence verticale, contact de limite ou horaires à vérifier."}</p>)}
      <p>{item.frequencies.values.length ? item.frequencies.values.map((frequency) => [frequency.name, frequency.value].filter(Boolean).join(" · ")).join(" ; ") : "Fréquence indisponible"}</p>
      <p>{item.frequencies.notice}</p>
      <p>{item.activity.notice}</p>
    </section>)}
  </details>;
}

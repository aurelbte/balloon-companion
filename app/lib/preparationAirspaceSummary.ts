/** UI only: consume the existing detected/deduplicated list, never detect or merge zones here. */
export function describePreparationAirspaces({ count, hasTrajectory, hasUsableCoverage, coverageStatus }: {
  count: number;
  hasTrajectory: boolean;
  hasUsableCoverage: boolean;
  coverageStatus: "COMPLETE" | "PARTIAL" | "LOADING" | "UNAVAILABLE";
}) {
  // A detected zone is itself evidence of usable data, even while other tiles are pending.
  // Empty successfully loaded coverage is distinct from no loaded data.
  const known = hasTrajectory && (count > 0 || hasUsableCoverage);
  return {
    value: known ? String(count) : "?",
    label: known ? "Zones potentielles détectées" : coverageStatus === "LOADING" ? "Chargement…" : "Données indisponibles",
    coverageNotice: known && coverageStatus !== "COMPLETE" ? "Couverture partielle — liste non exhaustive" : null,
    emptyNotice: known ? "Aucune zone potentielle détectée dans les données disponibles." : "Données d'espaces aériens indisponibles pour cette analyse.",
  };
}

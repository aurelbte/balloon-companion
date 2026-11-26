/** Retired compatibility endpoint: dossier weather now comes only from its calculation evidence. */
export async function POST() {
  return Response.json({ error: "Recherche historique désactivée : le dossier utilise les acquisitions de sa trajectoire, indépendamment de sa date de rédaction." }, { status: 410, headers: { "Cache-Control": "no-store" } });
}

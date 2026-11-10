/** Retired: archive only payloads already used by /api/trajectory/project. */
export async function POST() {
  return Response.json({ error: "Acquisition séparée désactivée : seules les données du calcul peuvent être archivées." }, { status: 410, headers: { "Cache-Control": "no-store" } });
}

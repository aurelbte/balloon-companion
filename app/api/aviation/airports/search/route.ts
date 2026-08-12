import { searchAviationAirports } from "../../../../lib/aviation/airportSearch";

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.trim();
  if (!query || query.length < 2) return Response.json({ results: [] });
  try {
    return Response.json({ results: await searchAviationAirports(query) });
  } catch { return Response.json({ error: { code: "AIRPORT_SEARCH_UNAVAILABLE", message: "La recherche d’aérodrome est indisponible." } }, { status: 502 }); }
}

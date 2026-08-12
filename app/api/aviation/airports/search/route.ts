import { normalizeAirportIcao } from "../../../../lib/aviation/aviationWeather";

type NominatimAirport = { place_id?: number; display_name?: string; extratags?: { icao?: string; iata?: string } };

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.trim();
  if (!query || query.length < 2) return Response.json({ results: [] });
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "8");
  url.searchParams.set("extratags", "1");
  try {
    const response = await fetch(url, { headers: { accept: "application/json", "accept-language": "fr", "user-agent": "Balloon-Companion/1.0 (aviation airport search)" }, cache: "force-cache" });
    if (!response.ok) throw new Error();
    const payload: unknown = await response.json();
    const results = Array.isArray(payload) ? payload.flatMap((item: NominatimAirport) => { const icao = normalizeAirportIcao(item.extratags?.icao) ?? normalizeAirportIcao(query); return icao && typeof item.display_name === "string" ? [{ id: String(item.place_id ?? icao), icao, name: item.display_name }] : []; }).filter((item, index, all) => all.findIndex(({ icao }) => icao === item.icao) === index) : [];
    return Response.json({ results });
  } catch { return Response.json({ error: { code: "AIRPORT_SEARCH_UNAVAILABLE", message: "La recherche d’aérodrome est indisponible." } }, { status: 502 }); }
}

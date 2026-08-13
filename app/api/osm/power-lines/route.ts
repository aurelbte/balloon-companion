import {
  buildPowerLinesQuery,
  toPowerLineGeoJson,
  type OverpassPowerLineResponse,
  type PowerLineBounds,
} from "../../../lib/powerLines";

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const bounds: PowerLineBounds = {
    west: Number(params.get("west")),
    south: Number(params.get("south")),
    east: Number(params.get("east")),
    north: Number(params.get("north")),
  };
  const values = Object.values(bounds);
  if (values.some((value) => !Number.isFinite(value)) || bounds.east <= bounds.west || bounds.north <= bounds.south || bounds.east - bounds.west > 2 || bounds.north - bounds.south > 2) {
    return Response.json({ error: "Emprise invalide" }, { status: 400 });
  }

  try {
    const response = await fetch(OVERPASS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "BalloonCompanion/1.0",
      },
      body: new URLSearchParams({ data: buildPowerLinesQuery(bounds) }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) throw new Error(`Overpass ${response.status}`);
    const data = await response.json() as OverpassPowerLineResponse;
    return Response.json(toPowerLineGeoJson(data), { headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" } });
  } catch {
    return Response.json({ error: "Données indisponibles" }, { status: 503 });
  }
}

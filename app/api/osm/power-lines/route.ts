import {
  buildPowerLinesQuery,
  parsePowerLines,
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
  if (values.some((value) => !Number.isFinite(value)) || bounds.west < -180 || bounds.east > 180 || bounds.south < -90 || bounds.north > 90 || bounds.east <= bounds.west || bounds.north <= bounds.south || bounds.east - bounds.west > 2 || bounds.north - bounds.south > 2) {
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
    const data = parsePowerLines(await response.json());
    const result = { ...data, bounds, fetchedAt: new Date().toISOString() };
    return Response.json(result, { headers: { "Cache-Control": data.complete ? "public, max-age=3600, stale-while-revalidate=86400" : "no-store" } });
  } catch {
    return Response.json({ error: "Données indisponibles" }, { status: 503 });
  }
}

import {
  buildPowerLinesQuery,
  parsePowerLines,
  type PowerLineBounds,
} from "../../../lib/powerLines";

const OVERPASS_PROVIDERS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);
// Two attempts including body reads fit inside the client's 15-second timeout.
const TOTAL_BUDGET_MS = 12_000;
const PROVIDER_TIMEOUT_MS = 6_000;
const NO_STORE = { "Cache-Control": "no-store" };

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
    return Response.json({ error: "Emprise invalide" }, { status: 400, headers: NO_STORE });
  }

  const deadline = Date.now() + TOTAL_BUDGET_MS;
  for (const provider of OVERPASS_PROVIDERS) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    const signal = AbortSignal.timeout(Math.min(PROVIDER_TIMEOUT_MS, remaining));
    let status: number | undefined;
    let phase = "network";
    try {
      const response = await fetch(provider, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "BalloonCompanion/1.0",
        },
        body: new URLSearchParams({ data: buildPowerLinesQuery(bounds) }),
        signal,
      });
      status = response.status;
      if (!response.ok) {
        console.warn("[power-lines]", { provider, status, cause: "http" });
        // Release the failed response without waiting for its body.
        void response.body?.cancel().catch(() => {});
        if (RETRYABLE_STATUSES.has(status)) continue;
        break;
      }
      phase = "json";
      const payload = await response.json();
      phase = "validation";
      const data = parsePowerLines(payload);
      const result = { ...data, bounds, fetchedAt: new Date().toISOString() };
      return Response.json(result, { headers: { "Cache-Control": data.complete ? "public, max-age=3600, stale-while-revalidate=86400" : "no-store" } });
    } catch (error) {
      const timeout = signal.aborted || (error instanceof Error && error.name === "TimeoutError");
      console.warn("[power-lines]", { provider, status: status ?? null, cause: timeout ? "timeout" : phase });
      if (!timeout) break;
    }
  }
  return Response.json({ error: "Données indisponibles" }, { status: 503, headers: NO_STORE });
}

import {
  buildPowerLinesQuery,
  parsePowerLines,
  type PowerLineBounds,
} from "../../../lib/powerLines";
import { buildObstaclesQuery, obstacleKind, obstacleQueryBounds, parseObstacles } from "../../../lib/obstacles";

const OVERPASS_PROVIDERS = [
  "https://overpass-api.de/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];
const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);
// Two attempts including body reads fit inside the client's 15-second timeout.
const TOTAL_BUDGET_MS = 14_000;
const PRIMARY_TIMEOUT_MS = 12_000;
const SECONDARY_TIMEOUT_MS = 13_000;
// Avoid a near-certain failed fallback after the primary exhausts its budget.
const MIN_FALLBACK_BUDGET_MS = 3_000;
const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const includeObstacles = params.get("obstacles") === "1";
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
  for (const [index, provider] of OVERPASS_PROVIDERS.entries()) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    if (index > 0 && remaining < MIN_FALLBACK_BUDGET_MS) break;
    const providerTimeout = index === 0 ? PRIMARY_TIMEOUT_MS : SECONDARY_TIMEOUT_MS;
    const signal = AbortSignal.timeout(Math.min(providerTimeout, remaining));
    let status: number | undefined;
    let phase = "network";
    try {
      const response = await fetch(provider, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "BalloonCompanion/1.0",
        },
        body: new URLSearchParams({ data: buildPowerLinesQuery(bounds) + (includeObstacles ? buildObstaclesQuery(bounds) : "") }),
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
      // Keep the strict C10 parser on its original collection, never on obstacle points.
      const linePayload = includeObstacles && Array.isArray(payload?.elements)
        ? { ...payload, elements: payload.elements.filter((item: { tags?: Record<string, unknown> }) => !obstacleKind(item?.tags) || item?.tags?.power === "line") }
        : payload;
      const data = parsePowerLines(linePayload);
      const fetchedAt = new Date().toISOString();
      const obstacles = includeObstacles ? { ...parseObstacles(payload), bounds: obstacleQueryBounds(bounds), fetchedAt } : undefined;
      const result = { ...data, bounds, fetchedAt, ...(obstacles ? { obstacles } : {}) };
      return Response.json(result, { headers: { "Cache-Control": data.complete && (!obstacles || obstacles.complete) ? "public, max-age=3600, stale-while-revalidate=86400" : "no-store" } });
    } catch (error) {
      const timeout = signal.aborted || (error instanceof Error && error.name === "TimeoutError");
      console.warn("[power-lines]", { provider, status: status ?? null, cause: timeout ? "timeout" : phase });
      if (!timeout) break;
    }
  }
  return Response.json({ error: "Données indisponibles" }, { status: 503, headers: NO_STORE });
}

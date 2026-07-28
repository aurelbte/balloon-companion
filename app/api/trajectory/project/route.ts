import { orchestrateMultiAltitudeProjection } from "../../../lib/trajectory/multiProjectionServer";
import { OpenMeteoWindProvider } from "../../../lib/weather/openMeteo/adapter";
import {
  createOpenMeteoClient,
  getOpenMeteoServerConfig,
} from "../../../lib/weather/openMeteo/client";
import { parseOpenMeteoElevation } from "../../../lib/weather/openMeteo/parser";

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json(
      {
        ok: false,
        error: {
          code: "INVALID_REQUEST",
          message: "Le corps JSON de la requête est invalide.",
        },
      },
      { status: 400 },
    );
  }

  const client = createOpenMeteoClient(getOpenMeteoServerConfig());
  const result = await orchestrateMultiAltitudeProjection(payload, {
    async getTerrainAltitude(latitude, longitude) {
      return parseOpenMeteoElevation(
        await client.fetchElevation(latitude, longitude),
      );
    },
    createWindProvider(terrainAltitudeAmslM) {
      return new OpenMeteoWindProvider(client, terrainAltitudeAmslM);
    },
  });
  return Response.json(result.body, { status: result.status });
}

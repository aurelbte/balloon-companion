import { loadAviationWeather } from "../../../lib/aviation/aviationWeather";

export async function GET(request: Request) {
  const airport = new URL(request.url).searchParams.get("airport") ?? "";
  const result = await loadAviationWeather({ airport });
  const status = result.data ? 200 : result.error.code === "NO_AIRPORT" ? 400 : result.error.code === "NO_DATA" ? 404 : 502;
  return Response.json(result, { status });
}

const models = [
  ["GFS", "gfs_seamless", "Global", "384 h"],
  ["AROME", "arome_seamless", "France", "51 h"],
  ["ICON", "icon_seamless", "Global/régional", "180 h"],
  ["AROME HD", "meteofrance_arome_france_hd", "France", "42 h"],
  ["ECMWF", "ecmwf_ifs025", "Global", "360 h"],
  ["ICON-D2", "icon_d2", "Europe centrale", "48 h"],
  ["ARPEGE", "arpege_seamless", "Global", "102 h"],
];

const hourly = [
  "wind_speed_10m",
  "wind_direction_10m",
  "wind_speed_80m",
  "wind_direction_80m",
  "wind_speed_120m",
  "wind_direction_120m",
  "wind_speed_180m",
  "wind_direction_180m",
  "wind_speed_1000hPa",
  "wind_direction_1000hPa",
  "geopotential_height_1000hPa",
  "wind_speed_925hPa",
  "wind_direction_925hPa",
  "geopotential_height_925hPa",
].join(",");

const rows = [];
for (const [model, providerId, coverage, horizon] of models) {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", "50.631");
    url.searchParams.set("longitude", "3.058");
    url.searchParams.set("forecast_days", "1");
    url.searchParams.set("wind_speed_unit", "ms");
    url.searchParams.set("timezone", "UTC");
    url.searchParams.set("models", providerId);
    url.searchParams.set("hourly", hourly);
    try {
      const response = await fetch(url);
      const payload = await response.json();
      const keys = Object.keys(payload.hourly ?? {});
      rows.push({
        Model: model,
        ProviderId: providerId,
        Supported: response.ok ? "oui" : "non",
        Coverage: coverage,
        NearSurface: keys.includes("wind_speed_180m") ? "oui" : "non",
        Pressure: keys.includes("wind_speed_925hPa") ? "oui" : "non",
        Geopotential: keys.includes("geopotential_height_925hPa")
          ? "oui"
          : "non",
        Horizon: horizon,
        Result: response.ok ? "OK à Bondues" : payload.reason ?? response.status,
      });
    } catch (error) {
      rows.push({
        Model: model,
        ProviderId: providerId,
        Supported: "non vérifié",
        Coverage: coverage,
        NearSurface: "—",
        Pressure: "—",
        Geopotential: "—",
        Horizon: horizon,
        Result: error instanceof Error ? error.message : "Erreur réseau",
      });
    }
}

console.table(rows);

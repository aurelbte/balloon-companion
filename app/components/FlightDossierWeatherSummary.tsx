import type { FlightDossierWeather } from "../lib/flightDossierWeather";

export default function FlightDossierWeatherSummary({ data }: { data: FlightDossierWeather }) {
  return <details>
    <summary>Météo du dossier · {data.weatherModel}</summary>
    <p>{data.window.startAt} → {data.window.endAt} (UTC)</p>
    {(["departure", "landing"] as const).map((location) => <section key={location}>
      <strong>{location === "departure" ? "Départ" : "Atterrissage prévu"}</strong>
      {(["metar", "taf"] as const).map((product) => {
        const item = data.aviation[location][product];
        const weather = item.result.data;
        return <div key={product}>
          <p>{product.toUpperCase()} · {item.station ? `${item.station.icao} · ${item.station.name} · ${item.station.distanceKm.toFixed(1)} km (${item.station.latitude}, ${item.station.longitude})` : "Station indisponible"} · {item.status}</p>
          <p>{weather ? (product === "metar" ? weather.metarRaw : weather.tafRaw) ?? "Message indisponible" : item.result.error?.message}</p>
          {item.freshness && <p>{item.freshness.label}</p>}
          {weather && <p>Émis : {(product === "metar" ? weather.metarIssuedAt : weather.tafIssuedAt) ?? "date indisponible"} · Récupéré : {weather.sourceUpdatedAt}</p>}
        </div>;
      })}
    </section>)}
    {([data.altitudeWind, data.landingGroundWind] as const).map((series, index) => <section key={index}>
      <strong>{index === 0 ? "Vent par altitude au départ" : "Vent à 10 m à l’atterrissage"} · {series.status}</strong>
      <p>{series.points.length} échéances · Récupéré : {series.fetchedAt ?? "indisponible"}</p>
      {series.missingHours.length > 0 && <p>Heures indisponibles : {series.missingHours.join(", ")}</p>}
      {series.error && <p>{series.error}</p>}
    </section>)}
    {data.altitudeWind.points.filter((point) => point.rejectedLevels.length > 0).map((point) => <p key={point.validAt}>{point.validAt} · Niveaux indisponibles : {point.rejectedLevels.map((level) => `${level.sourceLevel} (${level.reason})`).join(", ")}</p>)}
    {data.landingGroundWind.points.filter((point) => point.unavailableFields.length > 0).map((point) => <p key={point.validAt}>{point.validAt} · Données au sol indisponibles : {point.unavailableFields.join(", ")}</p>)}
    {data.notices.map((notice) => <p key={notice}>{notice}</p>)}
  </details>;
}

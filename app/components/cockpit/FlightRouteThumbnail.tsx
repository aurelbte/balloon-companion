import type { RoutePoint } from "./types";
import styles from "./Cockpit.module.css";

type FlightRouteThumbnailProps = {
  route: readonly RoutePoint[];
};

function routeToSvgPoints(route: readonly RoutePoint[]) {
  if (route.length === 0) {
    return "";
  }

  const longitudes = route.map((point) => point.longitude);
  const latitudes = route.map((point) => point.latitude);
  const minLongitude = Math.min(...longitudes);
  const maxLongitude = Math.max(...longitudes);
  const minLatitude = Math.min(...latitudes);
  const maxLatitude = Math.max(...latitudes);
  const longitudeSpan = Math.max(maxLongitude - minLongitude, 0.001);
  const latitudeSpan = Math.max(maxLatitude - minLatitude, 0.001);

  return route
    .map((point) => {
      const x = 14 + ((point.longitude - minLongitude) / longitudeSpan) * 132;
      const y = 70 - ((point.latitude - minLatitude) / latitudeSpan) * 56;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

export default function FlightRouteThumbnail({
  route,
}: FlightRouteThumbnailProps) {
  const points = routeToSvgPoints(route);
  const pointPairs = points.split(" ");
  const start = pointPairs[0];
  const end = pointPairs.at(-1);

  return (
    <div className={styles.routeThumbnail} aria-hidden="true">
      <svg viewBox="0 0 160 84" preserveAspectRatio="none">
        <path className={styles.mapRoad} d="M-8 58 C28 33 54 73 91 45 S142 30 169 12" />
        <path className={styles.mapRoadSecondary} d="M21 -8 C34 22 18 42 42 92" />
        <path className={styles.mapRoadSecondary} d="M111 -6 C101 26 132 48 121 94" />
        <path className={styles.mapBoundary} d="M-5 25 C35 18 53 31 83 21 S135 8 166 28" />
        {points && (
          <>
            <polyline className={styles.routeLineHalo} points={points} />
            <polyline className={styles.routeLine} points={points} />
            {start && (
              <circle
                className={styles.routeStart}
                cx={start.split(",")[0]}
                cy={start.split(",")[1]}
                r="3.5"
              />
            )}
            {end && (
              <circle
                className={styles.routeEnd}
                cx={end.split(",")[0]}
                cy={end.split(",")[1]}
                r="3.5"
              />
            )}
          </>
        )}
      </svg>
    </div>
  );
}

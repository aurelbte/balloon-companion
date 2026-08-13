export type SunTimes = { sunrise: string; sunset: string };

const radians = (degrees: number) => degrees * Math.PI / 180;
const degrees = (value: number) => value * 180 / Math.PI;
const normalize = (value: number, range: number) => ((value % range) + range) % range;

function eventTimestamp(date: string, latitude: number, longitude: number, sunrise: boolean): number | null {
  const [year, month, day] = date.split("-").map(Number);
  if (!year || !month || !day) return null;
  const dayOfYear = Math.floor((Date.UTC(year, month - 1, day) - Date.UTC(year, 0, 0)) / 86_400_000);
  const approximate = dayOfYear + ((sunrise ? 6 : 18) - longitude / 15) / 24;
  const anomaly = 0.9856 * approximate - 3.289;
  const longitudeTrue = normalize(anomaly + 1.916 * Math.sin(radians(anomaly)) + 0.02 * Math.sin(radians(2 * anomaly)) + 282.634, 360);
  let rightAscension = normalize(degrees(Math.atan(0.91764 * Math.tan(radians(longitudeTrue)))), 360);
  rightAscension = (rightAscension + Math.floor(longitudeTrue / 90) * 90 - Math.floor(rightAscension / 90) * 90) / 15;
  const sinDeclination = 0.39782 * Math.sin(radians(longitudeTrue));
  const cosDeclination = Math.cos(Math.asin(sinDeclination));
  const cosHourAngle = (Math.cos(radians(90.833)) - sinDeclination * Math.sin(radians(latitude))) / (cosDeclination * Math.cos(radians(latitude)));
  if (cosHourAngle < -1 || cosHourAngle > 1) return null;
  const hourAngle = (sunrise ? 360 - degrees(Math.acos(cosHourAngle)) : degrees(Math.acos(cosHourAngle))) / 15;
  const utcHours = normalize(hourAngle + rightAscension - 0.06571 * approximate - 6.622 - longitude / 15, 24);
  return Date.UTC(year, month - 1, day) + utcHours * 3_600_000;
}

export function calculateSunTimes(date: string | undefined, latitude: number | undefined, longitude: number | undefined, timeZone: string | undefined): SunTimes | null {
  if (!date || latitude === undefined || longitude === undefined || !timeZone) return null;
  const sunrise = eventTimestamp(date, latitude, longitude, true);
  const sunset = eventTimestamp(date, latitude, longitude, false);
  if (sunrise === null || sunset === null) return null;
  try {
    const formatter = new Intl.DateTimeFormat("fr-FR", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    return { sunrise: formatter.format(sunrise), sunset: formatter.format(sunset) };
  } catch { return null; }
}

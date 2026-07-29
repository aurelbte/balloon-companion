import type { FlightRecordSources } from "./entities.ts";

function canonicalize(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  if (typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(
        ([key, item]) =>
          `${JSON.stringify(key)}:${canonicalize(item)}`,
      )
      .join(",")}}`;
  }
  return JSON.stringify(String(value));
}

function fnv1a32(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Produces a deterministic integrity fingerprint. It is intentionally not a
 * cryptographic or legal signature.
 */
export function createFlightRecordFingerprint(
  sources: FlightRecordSources,
): string {
  return fnv1a32(canonicalize(sources));
}

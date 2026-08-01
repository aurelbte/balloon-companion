export type DemoLoadDiagnosticAvailability = {
  terrain: boolean;
  temperature: boolean;
  balloon: boolean;
  occupantsWeight: boolean;
  maximumAltitude: boolean;
};

export function formatDemoLoadDiagnostic(status: DemoLoadDiagnosticAvailability): string {
  const mark = (available: boolean) => available ? "✓" : "✕";
  return `TERRAIN ${mark(status.terrain)} · TEMP ${mark(status.temperature)} · BALLON ${mark(status.balloon)} · POIDS ${mark(status.occupantsWeight)} · ALT ${mark(status.maximumAltitude)}`;
}

export const MAIN_NAVIGATION_ITEMS = [
  { label: "Accueil", href: "/" },
  { label: "Préparer", href: "/prepare" },
  { label: "Vol", href: "/flight" },
  { label: "Journal", href: "/flights" },
] as const;

export type FlightNavigationAction = "STAY" | "CONTINUE" | "FINALIZE";

export function getFlightNavigationIntent({
  target,
  isFlightRecording,
}: {
  target: string;
  isFlightRecording: boolean;
}):
  | { kind: "NAVIGATE"; target: string }
  | { kind: "CONFIRM"; target: string } {
  return isFlightRecording
    ? { kind: "CONFIRM", target }
    : { kind: "NAVIGATE", target };
}

export function resolveFlightNavigationAction({
  action,
  pendingTarget,
}: {
  action: FlightNavigationAction;
  pendingTarget: string | null;
}): {
  navigateTo: string | null;
  shouldFinalize: boolean;
  pendingTarget: null;
} {
  if (action === "STAY") {
    return {
      navigateTo: null,
      shouldFinalize: false,
      pendingTarget: null,
    };
  }
  return {
    navigateTo: pendingTarget,
    shouldFinalize: action === "FINALIZE",
    pendingTarget: null,
  };
}

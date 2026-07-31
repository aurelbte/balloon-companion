type MainNavigationItem = {
  label: string;
  href: string;
  icon: "cockpit" | "prepare" | "flight" | "journal" | "more";
  disabled?: boolean;
};

export const MAIN_NAVIGATION_ITEMS = [
  { label: "Cockpit", href: "/", icon: "cockpit" },
  { label: "Prépa", href: "/prepare", icon: "prepare" },
  { label: "Vol", href: "/flight", icon: "flight" },
  { label: "Journal", href: "/journal", icon: "journal" },
  { label: "Plus", href: "#plus", icon: "more", disabled: true },
] as const satisfies readonly MainNavigationItem[];

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

import type { Balloon } from "./balloons.ts";

export type BalloonMassFormDraft = Readonly<{
  envelope: string;
  burner: string;
  basket: string;
  cylinders: readonly Readonly<{ id: string; label: string; weight: string }>[];
}>;

export function balloonMassFormDraft(balloon: Balloon | undefined): BalloonMassFormDraft {
  return {
    envelope: balloon?.weights.envelopeKg === undefined ? "" : String(balloon.weights.envelopeKg),
    burner: balloon?.weights.burnerKg === undefined ? "" : String(balloon.weights.burnerKg),
    basket: balloon?.weights.basketKg === undefined ? "" : String(balloon.weights.basketKg),
    cylinders: balloon?.weights.fullCylinders.map(({ id, label, fullWeightKg }) => ({ id, label: label ?? "", weight: String(fullWeightKg) })) ?? [],
  };
}

export function canSubmitHydratedBalloonForm(hydrationReady: boolean, formValid: boolean): boolean {
  return hydrationReady && formValid;
}

export type LoadDisplayPolicy = Readonly<{
  showSyntheticBadge: boolean;
  showSyntheticMargin: boolean;
  openSyntheticDetail: boolean;
}>;

/** Sépare l'exécution technique du moteur DEMO de l'exposition de ses résultats synthétiques. */
export function loadDisplayPolicy(input: Readonly<{
  demoEnabled: boolean;
  syntheticMarginRequested: boolean;
  resultAvailable: boolean;
}>): LoadDisplayPolicy {
  const showSyntheticMargin = input.demoEnabled
    && input.syntheticMarginRequested
    && input.resultAvailable;

  return {
    showSyntheticBadge: input.demoEnabled,
    showSyntheticMargin,
    openSyntheticDetail: showSyntheticMargin,
  };
}

/** Offline completion needs an HTML navigation, not an uncached Next RSC request. */
export function navigateToFlightCompletion(
  path: string,
  router: { push(path: string): void },
): void {
  if (!navigator.onLine) window.location.assign(path);
  else router.push(path);
}

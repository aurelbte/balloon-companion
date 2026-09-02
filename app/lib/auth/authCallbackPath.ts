export function isIsolatedAuthCallbackPath(pathname: string): boolean {
  return pathname === "/auth/confirmed" || pathname === "/auth/reset-password";
}

/**
 * Balloon Companion design tokens.
 *
 * CSS variables remain the rendering source of truth. This typed map gives
 * TypeScript and non-DOM integrations (for example MapLibre) stable names
 * without duplicating raw visual values.
 */
export const designTokens = {
  color: {
    navigation: "var(--bc-color-navigation)",
    thermal: "var(--bc-color-thermal)",
    launch: "var(--bc-color-launch)",
    warning: "var(--bc-color-warning)",
    danger: "var(--bc-color-danger)",
    cloud: "var(--bc-color-cloud)",
    slate: "var(--bc-color-slate)",
    night: "var(--bc-color-night)",
    canvas: "var(--bc-color-canvas)",
    surface: "var(--bc-color-surface)",
    surfaceGlass: "var(--bc-color-surface-glass)",
    surfaceFloating: "var(--bc-color-surface-floating)",
    surfaceOverlay: "var(--bc-color-surface-overlay)",
    border: "var(--bc-color-border)",
    text: "var(--bc-color-text)",
    textSecondary: "var(--bc-color-text-secondary)",
    textMuted: "var(--bc-color-text-muted)",
  },
  space: {
    1: "var(--bc-space-1)",
    2: "var(--bc-space-2)",
    3: "var(--bc-space-3)",
    4: "var(--bc-space-4)",
    6: "var(--bc-space-6)",
    8: "var(--bc-space-8)",
    12: "var(--bc-space-12)",
    16: "var(--bc-space-16)",
  },
  radius: {
    chip: "var(--bc-radius-chip)",
    control: "var(--bc-radius-control)",
    panel: "var(--bc-radius-panel)",
    dock: "var(--bc-radius-dock)",
    round: "var(--bc-radius-round)",
  },
  shadow: {
    xs: "var(--bc-shadow-xs)",
    panel: "var(--bc-shadow-panel)",
    floating: "var(--bc-shadow-floating)",
    dock: "var(--bc-shadow-dock)",
  },
  typography: {
    label: "var(--bc-font-size-label)",
    body: "var(--bc-font-size-body)",
    display: "var(--bc-font-size-display)",
    regular: "var(--bc-font-weight-regular)",
    semibold: "var(--bc-font-weight-semibold)",
    bold: "var(--bc-font-weight-bold)",
  },
  motion: {
    fast: "var(--bc-duration-fast)",
    normal: "var(--bc-duration-normal)",
    slow: "var(--bc-duration-slow)",
    easing: "var(--bc-easing-standard)",
  },
  zIndex: {
    base: "var(--bc-z-base)",
    mapContent: "var(--bc-z-map-content)",
    floating: "var(--bc-z-floating)",
    panel: "var(--bc-z-panel)",
    navigation: "var(--bc-z-navigation)",
    dialog: "var(--bc-z-dialog)",
    toast: "var(--bc-z-toast)",
  },
} as const;

export type DesignTokens = typeof designTokens;

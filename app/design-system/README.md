# Balloon Companion Design System

This folder is the visual foundation of Balloon Companion. It must not contain
flight, weather, GPS, storage, or map-domain logic.

## Source of truth

- Raw values live once as CSS custom properties in `app/globals.css`.
- `tokens.ts` exposes typed CSS-variable references for TypeScript consumers.
- `components.tsx` contains the reusable interface primitives.

## Rules

- Spacing uses only 4, 8, 12, 16, 24, 32, 48, or 64 px.
- Use `chip`, `control`, `panel`, or `dock` radii according to purpose.
- Typography is limited to label, body, and display sizes and to regular,
  semibold, and bold weights.
- Motion uses only fast, normal, or slow durations and respects
  `prefers-reduced-motion`.
- Map-domain colors that encode data keep their own centralized domain
  configuration. Design tokens style the interface around the map.

## Components

- `Button`: primary, secondary, and destructive actions.
- `Chip`: compact map/filter selection.
- `Panel`: solid contextual surface.
- `FloatingPanel`: translucent contextual map surface.
- `Card`: standard information surface.
- `BottomDock`: safe-area-aware bottom control.
- `SegmentedControl`: mutually exclusive options.
- `FloatingAction`: one-hand map action with a 48 px target.

Components accept `className` so layout remains the responsibility of the
screen, while shape, color, elevation, typography, and motion remain governed
by the system.

## Surfaces and elevation

- Surfaces: `solid`, `glass`, `floating`, and `overlay`.
- Shadows: `xs`, `panel`, `floating`, and `dock`.
- Named motion: `press`, `lift`, `fade`, `slide`, and `dock`.

Motion communicates interaction or state only. It is removed automatically
when the operating system requests reduced motion.

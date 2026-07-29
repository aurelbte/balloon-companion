# Balloon Companion Cockpit

The flight screen follows a three-level reading hierarchy without introducing
new data or changing flight behavior.

## 1. Vital

- AMSL altitude is isolated at the upper-left edge and uses the largest
  immediately visible number.
- Vario owns the visual center of the bottom dock and receives a distinct,
  low-contrast instrument well.
- Heading, ground speed, flight duration, and distance retain fixed positions
  and tabular numerals so values do not jump while updating.

## 2. Navigation

- Planned-route information remains collapsed until requested.
- GPS and weather projections stay on the map, below the recorded flight track.
- Map-follow and projection-fit actions share one thumb-accessible control rail.

## 3. Context

- Map settings use `FloatingPanel`, `SegmentedControl`, and `Chip`.
- Current airspace stays visible at the top edge without competing with
  altitude.
- Destructive flight stop remains separated and requires the existing
  confirmation.

## Layout rules

- The map remains full-screen and every cockpit surface is translucent.
- Touch controls use 44 or 48 px minimum targets.
- Instrument values use tabular numerals.
- Vario communicates direction with sign, arrow, and color; color is never the
  only signal.
- No cockpit motion is decorative, and BCDS reduced-motion behavior applies.

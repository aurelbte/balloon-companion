# Flight cockpit — phase-aware visual hierarchy

This presentation layer never claims to determine an operational flight phase.
It changes no flight data and performs no new calculation. It uses only the
recording state and the climb/stable/descent visual states that already existed
for the vario.

## Pre-flight

- The instrument dock is slightly quieter.
- Altitude remains easy to locate.
- The existing start action remains the dominant interactive control.

## Climb

- Altitude and vario gain a small amount of relative scale.
- Other dock values reduce their opacity without disappearing.
- Direction continues to be expressed by sign, arrow, and color.

## Cruise

- Ground speed receives a small relative emphasis.
- Heading and duration retain stable positions.
- Vario remains central but does not visually signal urgency while stable.

## Descent / approach-compatible hierarchy

- Altitude and vario receive the same immediate prominence as during climb.
- Distance gains a small relative emphasis.
- Heading and duration remain visible with slightly reduced opacity.

The application has no existing, reliable `approach` state. Descent is therefore
not labelled as approach and the interface never claims that an approach has
been detected.

## Completed flight

The existing recorded-flight screen already takes visual priority over the
cockpit. No additional phase state or presentation was introduced behind it.

## Transitions

Only font size, opacity, background color, and text color transition, using the
BCDS normal duration. The global reduced-motion rule disables these transitions
when requested by the operating system.

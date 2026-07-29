# Flight Core Engine

`FlightSession` is the application-facing snapshot for Flight mode. It unifies
the outputs of existing owners without replacing them:

- `useGeolocation` remains responsible for browser GPS acquisition.
- `useFlightTracking` remains responsible for recording and persistence.
- trajectory utilities remain responsible for projections.
- `useFlightContext` remains responsible for current airspace evaluation.

`createFlightSession()` performs no domain calculation. It assembles those
outputs under one strict, versioned contract consumed by the Flight screen.

## Entities

- `FlightSession`: identity, state, time, position, altitude, motion,
  trajectory, statistics, projections, airspace, and recovery.
- `FlightPhase`: explicit phase vocabulary. `APPROACH` is never inferred.
- `FlightCapabilities`: read-only description of currently available actions.
- `FlightEvent` / `FlightEvents`: extensible discriminated event vocabulary.

The current hooks deliberately remain the state owners during this migration.
Future work can move them behind commands and events without changing component
contracts or the visible experience.

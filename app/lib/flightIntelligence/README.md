# Balloon Companion Flight Intelligence Foundations

This package is a pure observation layer over `FlightSession`.

It does not use React, MapLibre, storage, network access, APIs, or AI. It never
dispatches an action and never recommends a piloting decision.

## Pipeline

1. `extractFlightFacts()` exposes a stable factual projection.
2. `FlightTimeline.fromSession()` orders facts already timestamped by the
   session.
3. `ConsistencyEngine` reports contradictions without repairing them.
4. `ConfidenceEngine` qualifies provenance and data quality.
5. `ObservationEngine` produces factual observations and returns all artifacts.

## Current observations

- current flight/session state;
- unavailable or stale GPS position;
- presence of an interrupted recording;
- structural consistency issues:
  - recording without identity;
  - recording without start time;
  - completed flight without end time;
  - stale position marked usable;
  - projection without a current position.

These observations are not connected to the interface.

## Deliberate limits

- No approach detection.
- No airspace-entry warning.
- No trend, prediction, or recommendation.
- No merging across multiple snapshots.
- No confidence inferred from unavailable provenance.
- No mutation or correction of `FlightSession`.

Future rules should remain deterministic, cite their evidence, and describe a
fact rather than prescribe an action.

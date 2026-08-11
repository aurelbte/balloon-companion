"use client";

import { useEffect } from "react";
import { loadGpsStatisticsDiagnostic } from "../../lib/gpsStatsDiagnostic.ts";
import { IndexedDbRecordedFlightStorage } from "../../lib/recordedFlightStorage.ts";

export default function GpsStatsDiagnosticRunner() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    const parameters = new URLSearchParams(window.location.search);
    if (parameters.get("debugGpsStats") !== "1") return;
    const flightId = parameters.get("debugGpsFlightId") ?? undefined;
    void loadGpsStatisticsDiagnostic(new IndexedDbRecordedFlightStorage(), flightId)
      .then((diagnostic) => {
        if (!diagnostic) {
          console.info("[GPS Stats] Aucun RecordedFlight disponible");
          return;
        }
        console.group(`[GPS Stats] ${diagnostic.flightId} — lecture seule`);
        console.table({ ANCIEN: diagnostic.oldStatistics, NOUVEAU: diagnostic.newStatistics });
        console.table({ ...diagnostic.pointCounts, gapsBackground: diagnostic.gapOrBackgroundCount });
        console.info(`Segments: ${diagnostic.segmentCount}`);
        console.table(diagnostic.segments);
        console.table(diagnostic.gapDistanceLinks.map((gap) => ({
          gap: `Gap ${gap.gapNumber}`,
          distanceMeters: gap.distanceMeters,
          durationMilliseconds: gap.durationMilliseconds,
          implicitSpeedMetersPerSecond: gap.implicitSpeedMetersPerSecond,
          retained: gap.retained ? "OUI" : "NON",
          reason: gap.reason,
        })));
        console.table({
          distanceBrute: diagnostic.distanceDiagnostic.rawDistanceMeters,
          distanceSegmentee: diagnostic.distanceDiagnostic.segmentedDistanceMeters,
          distanceFiltree: diagnostic.distanceDiagnostic.filteredDistanceMeters,
          distanceGaps: diagnostic.distanceDiagnostic.gapDistanceMeters,
          distanceTotaleFinale: diagnostic.distanceDiagnostic.finalDistanceMeters,
          bruitRetire: diagnostic.distanceDiagnostic.removedNoiseMeters,
          pourcentageRetire: diagnostic.distanceDiagnostic.removedPercentage,
          microOscillationsNeutralisees: diagnostic.distanceDiagnostic.neutralizedMicroOscillations,
        });
        console.info("Records vitesse/vario", diagnostic.records);
        console.groupEnd();
      })
      .catch((error: unknown) => console.error("[GPS Stats] Diagnostic impossible", error));
  }, []);
  return null;
}

import { useCallback, useMemo, useRef, useState } from "react";
import {
  calculateAirspaceVerticalContext,
  normalizeOpenAipAltitudeLimit,
  type AirspaceVerticalContext,
} from "../lib/airspaceAltitude";
import type { AirspaceGeoJsonProperties } from "../lib/openaip";

interface UseSelectedAirspaceResult {
  selectedAirspaces: AirspaceGeoJsonProperties[];
  selectedAirspace: AirspaceGeoJsonProperties | null;
  selectedIndex: number;
  verticalContext: AirspaceVerticalContext | null;
  selectAirspaces: (airspaces: AirspaceGeoJsonProperties[]) => void;
  selectPrevious: () => void;
  selectNext: () => void;
  closeSelection: () => void;
}

export function useSelectedAirspace(
  currentAltitudeMeters: number | null,
  verticalAccuracyMeters: number | null
): UseSelectedAirspaceResult {
  const [selectedAirspaces, setSelectedAirspaces] = useState<
    AirspaceGeoJsonProperties[]
  >([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const selectedAirspacesRef = useRef<AirspaceGeoJsonProperties[]>([]);
  const selectedAirspace = selectedAirspaces[selectedIndex] ?? null;

  const verticalContext = useMemo(() => {
    if (!selectedAirspace) return null;

    return calculateAirspaceVerticalContext(
      normalizeOpenAipAltitudeLimit(selectedAirspace.lowerLimit),
      normalizeOpenAipAltitudeLimit(selectedAirspace.upperLimit),
      currentAltitudeMeters,
      verticalAccuracyMeters
    );
  }, [currentAltitudeMeters, selectedAirspace, verticalAccuracyMeters]);

  const selectAirspaces = useCallback(
    (airspaces: AirspaceGeoJsonProperties[]) => {
      selectedAirspacesRef.current = airspaces;
      setSelectedAirspaces(airspaces);
      setSelectedIndex(0);
    },
    []
  );

  const selectPrevious = useCallback(() => {
    setSelectedIndex((currentIndex) => {
      const count = selectedAirspacesRef.current.length;
      if (count === 0) return 0;
      return (
        (currentIndex - 1 + count) % count
      );
    });
  }, []);

  const selectNext = useCallback(() => {
    setSelectedIndex((currentIndex) => {
      const count = selectedAirspacesRef.current.length;
      if (count === 0) return 0;
      return (currentIndex + 1) % count;
    });
  }, []);

  const closeSelection = useCallback(() => {
    selectedAirspacesRef.current = [];
    setSelectedAirspaces([]);
    setSelectedIndex(0);
  }, []);

  return {
    selectedAirspaces,
    selectedAirspace,
    selectedIndex,
    verticalContext,
    selectAirspaces,
    selectPrevious,
    selectNext,
    closeSelection,
  };
}

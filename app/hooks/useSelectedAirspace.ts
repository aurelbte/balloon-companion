import { useCallback, useMemo, useRef, useState } from "react";
import {
  calculateAirspaceVerticalContext,
  normalizeOpenAipAltitudeLimit,
  type AirspaceVerticalContext,
} from "../lib/airspaceAltitude";
import type { AirspaceGeoJsonProperties } from "../lib/openaip";
import {
  adjacentAirspaceIndex,
  uniqueSelectedAirspaces,
} from "../lib/airspaceSelectionNavigation";

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
      const unique = uniqueSelectedAirspaces(airspaces);
      selectedAirspacesRef.current = unique;
      setSelectedAirspaces(unique);
      setSelectedIndex(0);
    },
    []
  );

  const selectPrevious = useCallback(() => {
    setSelectedIndex((currentIndex) => {
      const count = selectedAirspacesRef.current.length;
      if (count === 0) return 0;
      return adjacentAirspaceIndex(currentIndex, count, -1);
    });
  }, []);

  const selectNext = useCallback(() => {
    setSelectedIndex((currentIndex) => {
      const count = selectedAirspacesRef.current.length;
      if (count === 0) return 0;
      return adjacentAirspaceIndex(currentIndex, count, 1);
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

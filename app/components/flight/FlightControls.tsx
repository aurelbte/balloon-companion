"use client";

import { LocateFixed, Map, Maximize2, Play, Square, UsersRound } from "lucide-react";
import type { LiveSharingConnectionState } from "../../lib/liveFlightUi.ts";
import { FLIGHT_BOTTOM_LAYOUT } from "../../lib/flightMapPresentation";
import { Button, FloatingAction } from "../../design-system";

interface FlightControlsProps {
  isTracking: boolean;
  followPosition: boolean;
  mapOptionsOpen: boolean;
  mapDisplayCustomized: boolean;
  liveSharingOpen: boolean;
  liveRecipientCount: number;
  liveConnectionState: LiveSharingConnectionState;
  withNavigation?: boolean;
  onRecenterMap: () => void;
  onFitProjection: () => void;
  onToggleMapOptions: () => void;
  onToggleLiveSharing: () => void;
  onStartTracking: () => void;
  onStopTracking: () => void;
}

export default function FlightControls({
  isTracking,
  followPosition,
  mapOptionsOpen,
  mapDisplayCustomized,
  liveSharingOpen,
  liveRecipientCount,
  liveConnectionState,
  withNavigation = false,
  onRecenterMap,
  onFitProjection,
  onToggleMapOptions,
  onToggleLiveSharing,
  onStartTracking,
  onStopTracking,
}: FlightControlsProps) {
  return (
    <div
      className="flight-control-cluster"
      style={{
        position: "fixed",
        bottom: withNavigation
          ? `calc(max(16px, env(safe-area-inset-bottom)) + ${FLIGHT_BOTTOM_LAYOUT.controlsBottomOffset}px)`
          : "calc(max(6px, env(safe-area-inset-bottom)) + 124px)",
        right: "16px",
        display: "flex",
        flexDirection: "column" as const,
        gap: "var(--bc-space-2)",
        alignItems: "flex-end",
        zIndex: "var(--bc-z-panel)",
      }}
    >
      <div
        className="bc-surface--floating"
        style={{
          display: "grid",
          gap: "var(--bc-space-1)",
          padding: "var(--bc-space-1)",
          border: "1px solid var(--bc-color-border-glass)",
          borderRadius: "var(--bc-radius-dock)",
          boxShadow: "var(--bc-shadow-card)",
          backdropFilter: "blur(20px)",
        }}
      >
        <FloatingAction
          onClick={onRecenterMap}
          title="Suivre ma position"
          aria-label={
            followPosition
              ? "Suivi de position actif"
              : "Réactiver le suivi de position"
          }
          aria-pressed={followPosition}
          style={
            followPosition
              ? {
                  borderColor: "var(--bc-color-action)",
                  color: "var(--bc-color-action)",
                }
              : undefined
          }
        >
          <LocateFixed size={20} />
        </FloatingAction>

        <FloatingAction
          onClick={onFitProjection}
          title="Vue élargie de la trajectoire"
          aria-label="Afficher une vue élargie de la trajectoire projetée"
        >
          <Maximize2 size={20} />
        </FloatingAction>

        <FloatingAction
          onClick={onToggleLiveSharing}
          title="Amis et partage du vol"
          aria-label="Amis et partage du vol"
          aria-expanded={liveSharingOpen}
          style={liveSharingOpen || liveRecipientCount > 0 ? { position: "relative", borderColor: "var(--bc-color-action)", color: "var(--bc-color-action)" } : { position: "relative" }}
        >
          <UsersRound size={20} />
          {liveRecipientCount > 0 && <span aria-label={`${liveRecipientCount} destinataire${liveRecipientCount > 1 ? "s" : ""}`} style={{ position: "absolute", top: 1, right: 1, display: "grid", placeItems: "center", minWidth: 16, height: 16, paddingInline: 3, borderRadius: 999, background: "var(--bc-color-action)", color: "#07111f", fontSize: 9, fontWeight: 950 }}>{liveRecipientCount}</span>}
          {liveConnectionState === "RECONNECTING" && <span aria-label="Reconnexion" style={{ position: "absolute", bottom: 3, right: 3, width: 7, height: 7, borderRadius: "50%", background: "#f59e0b" }} />}
        </FloatingAction>

        <FloatingAction
          onClick={onToggleMapOptions}
          title="Carte"
          aria-label="Options de carte"
          aria-expanded={mapOptionsOpen}
          aria-pressed={mapDisplayCustomized}
          style={
            mapOptionsOpen || mapDisplayCustomized
              ? {
                  borderColor: "var(--bc-color-action)",
                  color: "var(--bc-color-action)",
                }
              : undefined
          }
        >
          <Map size={20} />
        </FloatingAction>
      </div>

      {!isTracking ? (
        <Button
          onClick={onStartTracking}
          className="text-[11px] tracking-[0.04em]"
          title="Démarrer le suivi"
          aria-label="Démarrer l'enregistrement du vol"
        >
          <Play size={20} fill="currentColor" />
          DÉMARRER
        </Button>
      ) : (
        <Button
          variant="danger"
          onClick={onStopTracking}
          className="text-[11px] tracking-[0.04em]"
          title="Arrêter le suivi"
          aria-label="Arrêter l'enregistrement du vol"
        >
          <Square size={18} fill="currentColor" />
          ARRÊTER
        </Button>
      )}
    </div>
  );
}

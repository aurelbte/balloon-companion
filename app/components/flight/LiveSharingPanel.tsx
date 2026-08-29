"use client";

import Link from "next/link";
import type { FriendProfile } from "../../lib/friends.ts";
import { sharedPilotInitials } from "../../lib/liveFlightMap.ts";
import { liveSharingSummary, type LiveSharingUiState } from "../../lib/liveFlightUi.ts";
import { FLIGHT_BOTTOM_LAYOUT, MAP_OPTIONS_POPOVER_LAYOUT } from "../../lib/flightMapPresentation.ts";

export default function LiveSharingPanel({ open, friends, state, trackingActive, onClose, onToggleRecipient }: Readonly<{
  open: boolean;
  friends: readonly FriendProfile[];
  state: LiveSharingUiState;
  trackingActive: boolean;
  onClose: () => void;
  onToggleRecipient: (friendId: string) => void;
}>) {
  if (!open) return null;
  return <>
    <button type="button" aria-label="Fermer le partage du vol" onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 41, padding: 0, border: 0, background: "transparent" }} />
    <aside role="dialog" aria-label="Partage du vol" style={{ position: "fixed", top: `max(64px, calc(env(safe-area-inset-top) + ${MAP_OPTIONS_POPOVER_LAYOUT.topSafeClearance}px))`, right: `${MAP_OPTIONS_POPOVER_LAYOUT.right}px`, bottom: `calc(max(16px, env(safe-area-inset-bottom)) + ${FLIGHT_BOTTOM_LAYOUT.popoverBottomClearance}px)`, zIndex: 42, width: "min(286px, calc(100vw - 92px))", maxHeight: "100%", overflowY: "auto", padding: 12, border: "1px solid var(--bc-color-border-glass)", borderRadius: "var(--bc-radius-dock)", background: "rgba(7,17,31,.95)", color: "var(--bc-color-text)", boxShadow: "var(--bc-shadow-floating)", backdropFilter: "blur(20px)" }} onClick={(event) => event.stopPropagation()}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}><h2 style={{ margin: 0, fontSize: 15, fontWeight: 900 }}>Partage du vol</h2><button type="button" aria-label="Fermer le panneau de partage" onClick={onClose} style={{ width: 44, height: 44, border: 0, background: "transparent", color: "inherit", fontSize: 22 }}>×</button></header>
      <p role="status" style={{ margin: "2px 0 12px", color: state.connection === "OFFLINE" || state.connection === "RECONNECTING" ? "#fbbf24" : state.recipientIds.length ? "var(--bc-color-action)" : "var(--bc-color-text-secondary)", fontSize: 11, fontWeight: 800 }}>{liveSharingSummary(state)}</p>
      {friends.length === 0 ? <div><p style={{ color: "var(--bc-color-text-secondary)", fontSize: 12 }}>Aucun ami disponible</p><Link href="/more/friends" style={{ color: "var(--bc-color-action)", fontSize: 12, fontWeight: 800 }}>Gérer mes amis</Link></div> : <div style={{ display: "grid", gap: 8 }}>{friends.map((friend) => {
        const outgoing = state.recipientIds.includes(friend.userId);
        const pending = state.pendingRecipientIds.includes(friend.userId);
        const incoming = state.incomingPilotIds.includes(friend.userId);
        return <div key={friend.userId} style={{ padding: 9, border: "1px solid rgba(255,255,255,.12)", borderRadius: 11, background: "rgba(255,255,255,.035)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}><span aria-hidden="true" style={{ display: "grid", placeItems: "center", width: 30, height: 30, borderRadius: "50%", background: "#075985", color: "white", fontSize: 10, fontWeight: 900 }}>{sharedPilotInitials(friend.displayName)}</span><div><strong style={{ display: "block", fontSize: 12 }}>{friend.displayName}</strong><span style={{ color: "var(--bc-color-text-secondary)", fontSize: 10 }}>@{friend.handle}</span></div></div>
          <p style={{ minHeight: 15, margin: "7px 0", color: incoming ? "#7dd3fc" : "var(--bc-color-text-muted)", fontSize: 10, fontWeight: incoming ? 800 : 600 }}>{incoming ? "Partage son vol avec moi" : "Ne partage pas son vol avec moi"}</p>
          <button type="button" disabled={!trackingActive || pending} aria-pressed={outgoing} onClick={() => onToggleRecipient(friend.userId)} style={{ width: "100%", minHeight: 44, border: `1px solid ${outgoing ? "var(--bc-color-action)" : "var(--bc-color-border-glass)"}`, borderRadius: 9, background: outgoing ? "rgba(14,165,233,.18)" : "rgba(255,255,255,.05)", color: "var(--bc-color-text)", fontSize: 11, fontWeight: 850 }}>{pending ? "Activation…" : outgoing ? "Arrêter mon partage" : trackingActive ? "Partager mon vol" : "Démarrez le vol pour partager"}</button>
        </div>;
      })}</div>}
    </aside>
  </>;
}

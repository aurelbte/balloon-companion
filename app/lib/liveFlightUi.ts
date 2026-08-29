export type LiveSharingConnectionState = "IDLE" | "ACTIVE" | "RECONNECTING" | "OFFLINE";

export type LiveSharingUiState = Readonly<{
  recipientIds: readonly string[];
  incomingPilotIds: readonly string[];
  connection: LiveSharingConnectionState;
}>;

export const EMPTY_LIVE_SHARING_UI_STATE: LiveSharingUiState = {
  recipientIds: [],
  incomingPilotIds: [],
  connection: "IDLE",
};

export function toggleLiveRecipient(state: LiveSharingUiState, friendId: string): LiveSharingUiState {
  const selected = state.recipientIds.includes(friendId);
  return {
    ...state,
    recipientIds: selected
      ? state.recipientIds.filter((id) => id !== friendId)
      : [...state.recipientIds, friendId],
    connection: selected && state.recipientIds.length === 1 ? "IDLE" : state.connection === "OFFLINE" ? "OFFLINE" : "ACTIVE",
  };
}

export function liveSharingSummary(state: LiveSharingUiState): string {
  if (state.connection === "OFFLINE") return "Hors réseau — partage suspendu";
  if (state.connection === "RECONNECTING") return "Reconnexion…";
  const count = state.recipientIds.length;
  if (count === 0) return "Vol non partagé";
  return `Partagé avec ${count} ami${count > 1 ? "s" : ""}`;
}

export function stopLiveSharingUi(): LiveSharingUiState {
  return EMPTY_LIVE_SHARING_UI_STATE;
}

export function shouldResumeLiveSharingAfterReload(): boolean {
  return false;
}

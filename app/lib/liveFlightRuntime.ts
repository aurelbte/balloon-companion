import type { SupabaseClient } from "@supabase/supabase-js";
import { SharedPilotMapStore, type SharedPilotMapEntry } from "./liveFlightMap.ts";
import { buildLiveFlightPayload, shouldPublishLivePosition, type LiveFlightPositionPayload } from "./liveFlightSharing.ts";
import { LiveFlightRealtimeTransport, LiveShareSessionService, type LiveChannelState } from "./liveFlightTransport.ts";

export type LivePositionSource = Readonly<{
  latitude: number;
  longitude: number;
  altitude: number | null;
  groundSpeed: number | null;
  heading: number | null;
  durationSeconds: number;
  distanceKm: number;
  accuracy: number | null;
  gpsTimestamp: number;
  fresh: boolean;
}>;

export type IncomingLiveSession = Readonly<{ sessionId: string; ownerId: string; displayName: string; handle: string; expiresAt: string }>;
export type OutgoingLiveSnapshot = Readonly<{ recipientIds: readonly string[]; pendingRecipientIds: readonly string[]; channelState: LiveChannelState }>;

type RuntimeCallbacks = Readonly<{
  onOutgoing: (snapshot: OutgoingLiveSnapshot) => void;
  onIncomingPilots: (pilots: SharedPilotMapEntry[]) => void;
  onIncomingOwners: (ownerIds: readonly string[]) => void;
}>;

function rpcError(error: { message: string; code?: string } | null): void {
  if (error) throw new Error(error.code ? `${error.code}: ${error.message}` : error.message);
}

export class LiveFlightRuntime {
  private readonly sessions: LiveShareSessionService;
  private readonly outgoingTransport: LiveFlightRealtimeTransport;
  private readonly incoming = new Map<string, { session: IncomingLiveSession; transport: LiveFlightRealtimeTransport }>();
  private readonly pilots = new SharedPilotMapStore();
  private userId: string | null = null;
  private outgoingSessionId: string | null = null;
  private recipientIds: string[] = [];
  private pendingRecipientIds: string[] = [];
  private outgoingChannelState: LiveChannelState = "IDLE";
  private sequence = 0;
  private previousPayload: LiveFlightPositionPayload | null = null;
  private latestSource: LivePositionSource | null = null;
  private discoveryTimer: ReturnType<typeof setInterval> | null = null;
  private lifecycleAttached = false;
  private generation = 0;
  private outgoingEpoch = 0;
  private outgoingMutation: Promise<void> = Promise.resolve();
  private readonly client: SupabaseClient;
  private readonly callbacks: RuntimeCallbacks;

  constructor(client: SupabaseClient, callbacks: RuntimeCallbacks) {
    this.client = client;
    this.callbacks = callbacks;
    this.sessions = new LiveShareSessionService(client);
    this.outgoingTransport = new LiveFlightRealtimeTransport(client, this.sessions);
  }

  private emitOutgoing(): void {
    this.callbacks.onOutgoing({ recipientIds: [...this.recipientIds], pendingRecipientIds: [...this.pendingRecipientIds], channelState: this.outgoingChannelState });
  }

  async start(userId: string): Promise<void> {
    await this.close();
    this.userId = userId;
    const generation = ++this.generation;
    await this.refreshIncoming(generation);
    if (this.userId !== userId || this.generation !== generation) return;
    this.discoveryTimer = setInterval(() => { void this.refreshIncoming(generation); }, 10_000);
    this.attachLifecycle();
  }

  private async refreshLifecycle(): Promise<void> {
    const sessionId = this.outgoingSessionId;
    if (sessionId) {
      try { await this.sessions.heartbeat(sessionId); }
      catch { this.stopOutgoingBestEffort(); }
    }
    await this.refreshIncoming();
  }
  private readonly handleOnline = () => { void this.refreshLifecycle(); };
  private readonly handleVisibility = () => { if (document.visibilityState === "visible") void this.refreshLifecycle(); };
  private readonly handlePageShow = () => { void this.refreshLifecycle(); };
  private attachLifecycle(): void {
    if (this.lifecycleAttached || typeof window === "undefined") return;
    this.lifecycleAttached = true;
    window.addEventListener("online", this.handleOnline);
    window.addEventListener("pageshow", this.handlePageShow);
    document.addEventListener("visibilitychange", this.handleVisibility);
  }
  private detachLifecycle(): void {
    if (!this.lifecycleAttached || typeof window === "undefined") return;
    this.lifecycleAttached = false;
    window.removeEventListener("online", this.handleOnline);
    window.removeEventListener("pageshow", this.handlePageShow);
    document.removeEventListener("visibilitychange", this.handleVisibility);
  }

  private async connectOutgoing(sessionId: string, generation: number): Promise<void> {
    const userId = this.userId;
    if (!userId) return;
    await this.outgoingTransport.connect({
      userId,
      sessionId,
      mode: "PUBLISHER",
      onState: (state) => {
        if (generation !== this.generation || sessionId !== this.outgoingSessionId) return;
        this.outgoingChannelState = state;
        this.emitOutgoing();
      },
      onReadyToPublish: () => { if (this.latestSource) void this.publishSource(this.latestSource, true); },
    });
  }

  addRecipient(friendId: string, flightId: string | null): Promise<void> {
    const epoch = this.outgoingEpoch;
    const operation = this.outgoingMutation.then(() => epoch === this.outgoingEpoch ? this.addRecipientNow(friendId, flightId) : undefined);
    this.outgoingMutation = operation.catch(() => undefined);
    return operation;
  }

  private async addRecipientNow(friendId: string, flightId: string | null): Promise<void> {
    if (!this.userId || this.recipientIds.includes(friendId) || this.pendingRecipientIds.includes(friendId)) return;
    this.pendingRecipientIds.push(friendId); this.emitOutgoing();
    const generation = this.generation;
    try {
      if (!this.outgoingSessionId) {
        const sessionId = await this.sessions.start(flightId, [friendId]);
        if (generation !== this.generation) return;
        this.outgoingSessionId = sessionId;
        this.recipientIds = [friendId];
        this.sequence = 0; this.previousPayload = null;
        await this.connectOutgoing(sessionId, generation);
      } else {
        await this.sessions.addRecipient(this.outgoingSessionId, friendId);
        if (generation !== this.generation) return;
        this.recipientIds = [...this.recipientIds, friendId];
      }
    } finally {
      this.pendingRecipientIds = this.pendingRecipientIds.filter((id) => id !== friendId);
      this.emitOutgoing();
    }
  }

  removeRecipient(friendId: string): Promise<void> {
    const epoch = this.outgoingEpoch;
    const operation = this.outgoingMutation.then(() => epoch === this.outgoingEpoch ? this.removeRecipientNow(friendId) : undefined);
    this.outgoingMutation = operation.catch(() => undefined);
    return operation;
  }

  private async removeRecipientNow(friendId: string): Promise<void> {
    const oldSessionId = this.outgoingSessionId;
    if (!this.userId || !oldSessionId || !this.recipientIds.includes(friendId)) return;
    const generation = this.generation;
    this.pendingRecipientIds.push(friendId); this.emitOutgoing();
    await this.outgoingTransport.disconnect();
    this.outgoingChannelState = "CLOSED";
    try {
      const result = await this.client.rpc("rotate_live_share_after_recipient_revocation", { p_session_id: oldSessionId, p_recipient_id: friendId, p_ttl_seconds: 90 });
      rpcError(result.error);
      if (generation !== this.generation) return;
      this.recipientIds = this.recipientIds.filter((id) => id !== friendId);
      this.outgoingSessionId = typeof result.data === "string" ? result.data : null;
      this.sequence = 0; this.previousPayload = null;
      if (this.outgoingSessionId) await this.connectOutgoing(this.outgoingSessionId, generation);
      else this.outgoingChannelState = "IDLE";
    } finally {
      this.pendingRecipientIds = this.pendingRecipientIds.filter((id) => id !== friendId);
      this.emitOutgoing();
    }
  }

  async publishSource(source: LivePositionSource, force = false): Promise<boolean> {
    this.latestSource = source;
    const sessionId = this.outgoingSessionId;
    if (!sessionId || !this.userId || !source.fresh || this.recipientIds.length === 0) return false;
    const now = Date.now();
    const payload = buildLiveFlightPayload({ sessionId, sequence: this.sequence + 1, sentAt: now, gpsTimestamp: source.gpsTimestamp, latitude: source.latitude, longitude: source.longitude, altitude: source.altitude, groundSpeed: source.groundSpeed, heading: source.heading, durationSeconds: source.durationSeconds, distanceKm: source.distanceKm, accuracy: source.accuracy });
    if (!shouldPublishLivePosition({ now, current: payload, previous: this.previousPayload, force })) return false;
    const sent = await this.outgoingTransport.publish(payload, { trackingActive: true, gpsFresh: source.fresh, sessionActive: true, sharingEnabled: true, activeRecipientCount: this.recipientIds.length });
    if (sent) { this.sequence += 1; this.previousPayload = payload; }
    return sent;
  }

  async refreshIncoming(expectedGeneration = this.generation): Promise<void> {
    const userId = this.userId;
    if (!userId) return;
    const result = await this.client.rpc("discover_live_share_sessions");
    if (result.error || expectedGeneration !== this.generation || userId !== this.userId) return;
    const sessions = ((result.data ?? []) as Array<{ session_id: string; owner_id: string; display_name: string; handle: string; expires_at: string }>).map((row) => ({ sessionId: row.session_id, ownerId: row.owner_id, displayName: row.display_name, handle: row.handle, expiresAt: row.expires_at }));
    const nextIds = new Set(sessions.map(({ sessionId }) => sessionId));
    for (const [sessionId, active] of this.incoming) if (!nextIds.has(sessionId)) { await active.transport.disconnect(); this.incoming.delete(sessionId); this.pilots.removeSession(sessionId); }
    for (const session of sessions) {
      if (this.incoming.has(session.sessionId)) continue;
      const transport = new LiveFlightRealtimeTransport(this.client);
      this.incoming.set(session.sessionId, { session, transport });
      await transport.connect({ userId, sessionId: session.sessionId, mode: "RECEIVER", onPosition: (payload) => {
        if (expectedGeneration !== this.generation || userId !== this.userId) return;
        this.pilots.accept({ pilotId: session.ownerId, displayName: session.displayName, sessionId: session.sessionId }, payload);
        this.callbacks.onIncomingPilots(this.pilots.list());
      }, onEnded: () => {
        if (expectedGeneration !== this.generation || userId !== this.userId) return;
        this.pilots.removeSession(session.sessionId);
        this.callbacks.onIncomingPilots(this.pilots.list());
        void this.refreshIncoming(expectedGeneration);
      }});
    }
    this.callbacks.onIncomingOwners(sessions.map(({ ownerId }) => ownerId));
    this.callbacks.onIncomingPilots(this.pilots.list());
  }

  stopOutgoingBestEffort(): void {
    const stopEpoch = ++this.outgoingEpoch;
    const sessionId = this.outgoingSessionId;
    this.outgoingSessionId = null; this.recipientIds = []; this.pendingRecipientIds = []; this.sequence = 0; this.previousPayload = null; this.latestSource = null; this.outgoingChannelState = "IDLE"; this.emitOutgoing();
    void this.outgoingTransport.signalEnd()
      .catch(() => undefined)
      .then(() => stopEpoch === this.outgoingEpoch ? this.outgoingTransport.disconnect() : undefined)
      .then(() => sessionId ? this.sessions.stop(sessionId).catch(() => undefined) : undefined);
  }

  async close(): Promise<void> {
    this.generation += 1;
    if (this.discoveryTimer) clearInterval(this.discoveryTimer);
    this.discoveryTimer = null;
    this.detachLifecycle();
    this.stopOutgoingBestEffort();
    for (const { transport } of this.incoming.values()) await transport.disconnect();
    this.incoming.clear(); this.pilots.clearForUserSwitch(); this.callbacks.onIncomingOwners([]); this.callbacks.onIncomingPilots([]); this.userId = null;
  }
}

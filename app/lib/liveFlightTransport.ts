import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import {
  LIVE_HEARTBEAT_INTERVAL_MS,
  LIVE_SESSION_TTL_SECONDS,
  LiveSequenceGate,
  livePositionFreshness,
  liveReconnectDelayMs,
  validateLiveFlightPayload,
  type LiveFlightPositionPayload,
  type LivePositionFreshness,
} from "./liveFlightSharing.ts";

export type LiveChannelMode = "PUBLISHER" | "RECEIVER";
export type LiveChannelState = "IDLE" | "CONNECTING" | "SUBSCRIBED" | "OFFLINE" | "ERROR" | "CLOSED";
export type LivePublishContext = Readonly<{ trackingActive: boolean; gpsFresh: boolean; sessionActive: boolean; sharingEnabled: boolean; activeRecipientCount: number }>;

export function liveShareTopic(sessionId: string): string { return `flight-share:${sessionId}`; }

export function canPublishLiveFlight(input: Readonly<{
  authenticatedUserId: string | null;
  sessionOwnerId: string;
  trackingActive: boolean;
  gpsFresh: boolean;
  sessionActive: boolean;
  sharingEnabled: boolean;
  activeRecipientCount: number;
}>): boolean {
  return Boolean(input.authenticatedUserId)
    && input.authenticatedUserId === input.sessionOwnerId
    && input.trackingActive
    && input.gpsFresh
    && input.sessionActive
    && input.sharingEnabled
    && input.activeRecipientCount > 0;
}

function rpcFailure(error: { message: string; code?: string } | null): void {
  if (error) throw new Error(error.code ? `${error.code}: ${error.message}` : error.message);
}

export class LiveShareSessionService {
  private readonly client: SupabaseClient;
  constructor(client: SupabaseClient) { this.client = client; }
  async start(flightId: string | null, recipientIds: readonly string[]): Promise<string> {
    const result = await this.client.rpc("start_live_share_session", { p_flight_id: flightId ?? "", p_recipient_ids: [...recipientIds], p_ttl_seconds: LIVE_SESSION_TTL_SECONDS });
    rpcFailure(result.error);
    if (typeof result.data !== "string") throw new Error("INVALID_LIVE_SESSION_ID");
    return result.data;
  }
  async heartbeat(sessionId: string): Promise<string> {
    const result = await this.client.rpc("heartbeat_live_share_session", { p_session_id: sessionId, p_ttl_seconds: LIVE_SESSION_TTL_SECONDS });
    rpcFailure(result.error);
    if (typeof result.data !== "string") throw new Error("INVALID_LIVE_HEARTBEAT");
    return result.data;
  }
  async stop(sessionId: string): Promise<void> { const result = await this.client.rpc("stop_live_share_session", { p_session_id: sessionId }); rpcFailure(result.error); }
  async addRecipient(sessionId: string, recipientId: string): Promise<void> { const result = await this.client.rpc("add_live_share_recipient", { p_session_id: sessionId, p_recipient_id: recipientId }); rpcFailure(result.error); }
  async revokeRecipient(sessionId: string, recipientId: string): Promise<void> { const result = await this.client.rpc("revoke_live_share_recipient", { p_session_id: sessionId, p_recipient_id: recipientId }); rpcFailure(result.error); }
}

export class LiveFlightConnectionGuard {
  private generation = 0;
  private target: { userId: string; sessionId: string } | null = null;
  private retryAttempt = 0;
  activate(userId: string, sessionId: string): number { this.generation += 1; this.target = { userId, sessionId }; this.retryAttempt = 0; return this.generation; }
  valid(userId: string, sessionId: string, generation: number): boolean { return this.generation === generation && this.target?.userId === userId && this.target.sessionId === sessionId; }
  connected(): void { this.retryAttempt = 0; }
  disconnected(): number { return liveReconnectDelayMs(this.retryAttempt++); }
  close(): void { this.generation += 1; this.target = null; this.retryAttempt = 0; }
  current(): Readonly<{ userId: string; sessionId: string; generation: number }> | null { return this.target ? { ...this.target, generation: this.generation } : null; }
}

export class LiveFlightRealtimeTransport {
  private readonly client: SupabaseClient;
  private readonly sessions: LiveShareSessionService;
  private channel: RealtimeChannel | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private readonly guard = new LiveFlightConnectionGuard();
  private readonly sequences = new LiveSequenceGate();
  private activeConfig: { userId: string; sessionId: string; mode: LiveChannelMode; generation: number } | null = null;
  private onPosition: ((payload: LiveFlightPositionPayload, freshness: LivePositionFreshness) => void) | null = null;
  private onState: ((state: LiveChannelState) => void) | null = null;
  private onReadyToPublish: (() => void) | null = null;
  private lifecycleAttached = false;

  constructor(client: SupabaseClient, sessions = new LiveShareSessionService(client)) { this.client = client; this.sessions = sessions; }

  async connect(input: Readonly<{
    userId: string;
    sessionId: string;
    mode: LiveChannelMode;
    onPosition?: (payload: LiveFlightPositionPayload, freshness: LivePositionFreshness) => void;
    onState?: (state: LiveChannelState) => void;
    onReadyToPublish?: () => void;
  }>): Promise<void> {
    await this.disconnect();
    const generation = this.guard.activate(input.userId, input.sessionId);
    this.activeConfig = { userId: input.userId, sessionId: input.sessionId, mode: input.mode, generation };
    this.onPosition = input.onPosition ?? null;
    this.onState = input.onState ?? null;
    this.onReadyToPublish = input.onReadyToPublish ?? null;
    this.attachLifecycle();
    await this.openCurrentChannel();
    if (input.mode === "PUBLISHER") this.heartbeatTimer = setInterval(() => { void this.heartbeat(); }, LIVE_HEARTBEAT_INTERVAL_MS);
  }

  private async openCurrentChannel(): Promise<void> {
    const config = this.activeConfig;
    if (!config || !this.guard.valid(config.userId, config.sessionId, config.generation)) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) { this.onState?.("OFFLINE"); return; }
    this.onState?.("CONNECTING");
    await this.client.realtime.setAuth();
    if (!this.guard.valid(config.userId, config.sessionId, config.generation)) return;
    const channel = this.client.channel(liveShareTopic(config.sessionId), { config: { private: true, broadcast: { ack: true, self: false } } });
    channel.on("broadcast", { event: "position" }, (message: { payload?: unknown }) => {
      if (!this.guard.valid(config.userId, config.sessionId, config.generation)) return;
      const result = validateLiveFlightPayload(message.payload, config.sessionId);
      if (!result.ok || !this.sequences.accept(result.payload)) return;
      this.onPosition?.(result.payload, livePositionFreshness(result.payload.gpsTimestamp));
    });
    this.channel = channel;
    channel.subscribe((status) => {
      if (!this.guard.valid(config.userId, config.sessionId, config.generation)) return;
      if (status === "SUBSCRIBED") { this.guard.connected(); this.onState?.("SUBSCRIBED"); if (config.mode === "PUBLISHER") this.onReadyToPublish?.(); return; }
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") { this.onState?.("ERROR"); this.scheduleReconnect(); }
      if (status === "CLOSED") this.onState?.("CLOSED");
    });
  }

  async publish(payload: LiveFlightPositionPayload, context: LivePublishContext): Promise<boolean> {
    const config = this.activeConfig;
    if (!config || config.mode !== "PUBLISHER" || payload.sessionId !== config.sessionId || !this.channel || !this.guard.valid(config.userId, config.sessionId, config.generation)) return false;
    if (!canPublishLiveFlight({ authenticatedUserId: config.userId, sessionOwnerId: config.userId, ...context })) return false;
    const validation = validateLiveFlightPayload(payload, config.sessionId);
    if (!validation.ok) return false;
    return (await this.channel.send({ type: "broadcast", event: "position", payload: validation.payload })) === "ok";
  }

  private async heartbeat(): Promise<void> {
    const config = this.activeConfig;
    if (!config || config.mode !== "PUBLISHER" || !this.guard.valid(config.userId, config.sessionId, config.generation)) return;
    try { await this.sessions.heartbeat(config.sessionId); }
    catch { this.onState?.("ERROR"); await this.disconnect(); }
  }

  private scheduleReconnect(): void {
    if (this.retryTimer || !this.activeConfig) return;
    const delay = this.guard.disconnected();
    this.retryTimer = setTimeout(() => { this.retryTimer = null; void this.replaceChannel(); }, delay);
  }

  private async replaceChannel(): Promise<void> {
    if (this.channel) { const previous = this.channel; this.channel = null; await this.client.removeChannel(previous); }
    await this.openCurrentChannel();
  }

  private readonly handleOffline = () => { this.onState?.("OFFLINE"); void this.dropChannel(); };
  private readonly handleOnline = () => { if (this.activeConfig) void this.replaceChannel(); };
  private readonly handleVisibility = () => { if (document.visibilityState === "visible" && this.activeConfig) void this.replaceChannel(); };
  private readonly handlePageHide = () => { void this.dropChannel(); };
  private readonly handlePageShow = () => { if (this.activeConfig) void this.replaceChannel(); };

  private attachLifecycle(): void {
    if (this.lifecycleAttached || typeof window === "undefined") return;
    this.lifecycleAttached = true;
    window.addEventListener("offline", this.handleOffline);
    window.addEventListener("online", this.handleOnline);
    window.addEventListener("pagehide", this.handlePageHide);
    window.addEventListener("pageshow", this.handlePageShow);
    document.addEventListener("visibilitychange", this.handleVisibility);
  }

  private detachLifecycle(): void {
    if (!this.lifecycleAttached || typeof window === "undefined") return;
    this.lifecycleAttached = false;
    window.removeEventListener("offline", this.handleOffline);
    window.removeEventListener("online", this.handleOnline);
    window.removeEventListener("pagehide", this.handlePageHide);
    window.removeEventListener("pageshow", this.handlePageShow);
    document.removeEventListener("visibilitychange", this.handleVisibility);
  }

  private async dropChannel(): Promise<void> {
    if (!this.channel) return;
    const previous = this.channel; this.channel = null;
    await this.client.removeChannel(previous);
  }

  async disconnect(): Promise<void> {
    this.guard.close();
    this.activeConfig = null;
    this.sequences.reset();
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.retryTimer = null; this.heartbeatTimer = null;
    await this.dropChannel();
    this.detachLifecycle();
    this.onState?.("CLOSED");
    this.onPosition = null; this.onState = null; this.onReadyToPublish = null;
  }
}

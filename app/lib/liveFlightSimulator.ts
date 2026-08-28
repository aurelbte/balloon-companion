import { buildLiveFlightPayload, type LiveFlightPositionPayload } from "./liveFlightSharing.ts";

export type LiveSimulationScenario =
  | "NORMAL_FLIGHT"
  | "PROGRESSIVE_CLIMB"
  | "PROGRESSIVE_DESCENT"
  | "DIRECTION_CHANGE"
  | "FROZEN_20_SECONDS"
  | "NETWORK_LOSS_OVER_30_SECONDS"
  | "RECONNECTION"
  | "NORMAL_END"
  | "SIMULATED_CRASH"
  | "OUT_OF_ORDER"
  | "DUPLICATES"
  | "INVALID_PAYLOAD";

export type LiveSimulationEvent =
  | Readonly<{ kind: "POSITION"; at: number; payload: unknown }>
  | Readonly<{ kind: "NETWORK_OFFLINE" | "NETWORK_ONLINE" | "END" | "CRASH"; at: number }>;

const STEP_MS = 5_000;

function point(sessionId: string, startedAt: number, index: number, overrides: Partial<LiveFlightPositionPayload> = {}): LiveFlightPositionPayload {
  const sentAt = startedAt + index * STEP_MS;
  return buildLiveFlightPayload({
    sessionId,
    sequence: index + 1,
    sentAt,
    gpsTimestamp: sentAt,
    latitude: 50.686341 + index * 0.0004,
    longitude: 3.079865 + index * 0.0005,
    altitude: 120 + index * 2,
    groundSpeed: 5,
    heading: 52,
    durationSeconds: index * 5,
    distanceKm: index * 0.03,
    accuracy: 6,
    ...overrides,
  });
}

const positions = (payloads: readonly LiveFlightPositionPayload[]): LiveSimulationEvent[] => payloads.map((payload) => ({ kind: "POSITION", at: payload.sentAt, payload }));

export function simulateLiveFlightScenario(scenario: LiveSimulationScenario, sessionId: string, startedAt = 1_800_000_000_000): LiveSimulationEvent[] {
  const base = Array.from({ length: 6 }, (_, index) => point(sessionId, startedAt, index));
  switch (scenario) {
    case "NORMAL_FLIGHT": return positions(base);
    case "PROGRESSIVE_CLIMB": return positions(base.map((payload, index) => ({ ...payload, altitude: 120 + index * 15 })));
    case "PROGRESSIVE_DESCENT": return positions(base.map((payload, index) => ({ ...payload, altitude: 240 - index * 15 })));
    case "DIRECTION_CHANGE": return positions(base.map((payload, index) => ({ ...payload, heading: (45 + index * 35) % 360 })));
    case "FROZEN_20_SECONDS": return positions(base.map((payload, index) => index < 5 ? { ...payload, latitude: base[0].latitude, longitude: base[0].longitude, groundSpeed: 0 } : payload));
    case "NETWORK_LOSS_OVER_30_SECONDS": return [
      ...positions(base.slice(0, 2)),
      { kind: "NETWORK_OFFLINE", at: startedAt + 10_000 },
      { kind: "NETWORK_ONLINE", at: startedAt + 45_000 },
      { kind: "POSITION", at: startedAt + 45_000, payload: point(sessionId, startedAt, 9) },
    ];
    case "RECONNECTION": return [...positions(base.slice(0, 2)), { kind: "NETWORK_OFFLINE", at: startedAt + 10_000 }, { kind: "NETWORK_ONLINE", at: startedAt + 20_000 }, ...positions(base.slice(4, 6))];
    case "NORMAL_END": return [...positions(base), { kind: "END", at: startedAt + 30_000 }];
    case "SIMULATED_CRASH": return [...positions(base.slice(0, 3)), { kind: "CRASH", at: startedAt + 15_000 }];
    case "OUT_OF_ORDER": return positions([base[0], base[2], base[1]]);
    case "DUPLICATES": return positions([base[0], base[1], { ...base[1] }]);
    case "INVALID_PAYLOAD": return [{ kind: "POSITION", at: startedAt, payload: { ...base[0], latitude: 999, distanceKm: Number.NaN } }];
  }
}

export function createDevelopmentLiveFlightSimulator(environment = process.env.NODE_ENV) {
  if (environment !== "development" && environment !== "test") throw new Error("LIVE_SIMULATOR_DISABLED");
  return { run: simulateLiveFlightScenario };
}

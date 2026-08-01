import { createBalloon, REGISTERED_BALLOONS, type Balloon, type NewBalloonInput } from "./balloons";
const STORAGE_KEY = "balloon-companion-balloons";
const VERSION = 1;
export const NEW_BALLOON_SELECTION_KEY = "balloon-companion-new-balloon-selection";
export const NEW_BALLOON_RETURN_KEY = "balloon-companion-balloon-return";
type StoredBalloons = { version: typeof VERSION; balloons: readonly Balloon[] };
function isBalloon(value: unknown): value is Balloon { if (!value || typeof value !== "object") return false; const item = value as Partial<Balloon>; return typeof item.id === "string" && typeof item.registration === "string" && typeof item.manufacturer === "string" && typeof item.model === "string"; }
export function loadBalloons(): Balloon[] { if (typeof window === "undefined") return [...REGISTERED_BALLOONS]; try { const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<StoredBalloons> | null; if (parsed?.version === VERSION && Array.isArray(parsed.balloons)) return parsed.balloons.filter(isBalloon); } catch { /* Ignore invalid client data. */ } return [...REGISTERED_BALLOONS]; }
export function saveBalloons(balloons: readonly Balloon[]): void { if (typeof window === "undefined") return; window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: VERSION, balloons } satisfies StoredBalloons)); window.dispatchEvent(new Event("balloon-companion:balloons-changed")); }
export function addBalloon(input: NewBalloonInput): Balloon { const balloon = createBalloon(input); saveBalloons([...loadBalloons().filter(({ registration }) => registration !== balloon.registration), balloon]); return balloon; }

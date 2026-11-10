import { getRuntimeDataScope, getRuntimeDataScopeGeneration, scopedIndexedDbName } from "./auth/dataScopeRuntime.ts";
import type { LocalDataScope } from "./auth/dataScope.ts";
import type { FlightDossierData } from "./flightDossierPdf.ts";
import type { WeatherAnalysisTrace } from "./trajectory/weatherAnalysisStorage.ts";
import type { MoroccoWeatherCapture } from "./moroccoWeatherCapture.ts";

const DB = "balloon-companion-morocco-weather-v1";
const utcMs = (value: unknown): number => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T.*Z$/.test(value) ? Date.parse(value) : NaN;
export type MoroccoArchiveDossier = Omit<FlightDossierData, "balloon" | "operations">;
export type MoroccoWeatherArchive = MoroccoWeatherCapture & {
  version: 2; completeness: "PARTIAL" | "COMPLETE"; id: string; matchKey: string; receivedAt: string;
  dossier: MoroccoArchiveDossier; trajectory: WeatherAnalysisTrace;
};
export type SavedMoroccoWeatherArchive = MoroccoWeatherArchive & { storedAt: string };
export interface MoroccoWeatherArchiveStore {
  saveOnce(value: MoroccoWeatherArchive): Promise<void>;
  matching(key: string): Promise<SavedMoroccoWeatherArchive[]>;
}

/** Exact calculation identity is mandatory; legacy trace IDs never attest a preparation. */
export function moroccoWeatherMatchKey(dossier: MoroccoArchiveDossier): string {
  if (!dossier.moroccoPreparationIdentity) throw new Error("Identité complète de préparation Maroc absente ; archive ancienne refusée.");
  return JSON.stringify([dossier.moroccoPreparationIdentity, dossier.launchSiteName ?? "", dossier.startedAt, dossier.durationSeconds,
    dossier.launchTimeZone ?? "UTC", dossier.model.providerModelId, dossier.traceId]);
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([key, v]) => key !== "generationtime_ms" && v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, v]) => `${JSON.stringify(key)}:${stable(v)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

export function archiveSourceTimes(value: MoroccoWeatherArchive): string[] {
  return [value.receivedAt, value.weather.preparedAt, value.trajectory.weatherFetchedAt ?? "", value.trajectory.calculatedAtIso, ...(value.trajectory.modelRunAt ? [value.trajectory.modelRunAt] : []),
    ...value.rawForecasts.map(raw => raw.receivedAt),
    ...[value.weather.altitudeWind, value.weather.landingGroundWind].flatMap(series => series.fetchedAt ? [series.fetchedAt] : series.status === "UNAVAILABLE" ? [] : [""]),
    ...(["departure", "landing"] as const).flatMap(location => Object.values(value.weather.aviation[location]).flatMap(product => product.result.data ? [product.result.data.sourceUpdatedAt, product.result.data.metarIssuedAt, product.result.data.tafIssuedAt].filter((v): v is string => !!v) : []))];
}

export async function createMoroccoWeatherArchive(dossier: MoroccoArchiveDossier, trajectory: WeatherAnalysisTrace, capture: MoroccoWeatherCapture, receivedAt: string): Promise<MoroccoWeatherArchive> {
  const value = structuredClone({ ...capture, version: 2 as const, completeness: "PARTIAL" as const, id: "", matchKey: moroccoWeatherMatchKey(dossier), receivedAt, dossier, trajectory });
  if (!capture.rawForecasts.length || capture.rawForecasts.some(raw => raw.kind !== "calculation" || raw.model !== dossier.model.providerModelId || !raw.payload) ||
      trajectory.moroccoPreparationIdentity !== dossier.moroccoPreparationIdentity || capture.weather.traceId !== dossier.traceId || capture.weather.weatherModel !== dossier.model.providerModelId || trajectory.traceId !== dossier.traceId ||
      trajectory.model.providerModelId !== dossier.model.providerModelId || stable(trajectory.projection.points) !== stable(dossier.points) ||
      !Number.isFinite(utcMs(receivedAt)) || archiveSourceTimes(value).some(time => !Number.isFinite(utcMs(time)) || utcMs(time) > utcMs(receivedAt)))
    throw new Error("Horodatages UTC ou provenance de la préparation Maroc incomplets/incohérents : sauvegarde non effectuée.");
  const aviation = Object.fromEntries((["departure", "landing"] as const).map(location => [location,
    Object.fromEntries(Object.entries(capture.weather.aviation[location]).map(([product, item]) => [product, { station: item.station, metar: item.result.data?.metarRaw, taf: item.result.data?.tafRaw, metarIssuedAt: item.result.data?.metarIssuedAt, tafIssuedAt: item.result.data?.tafIssuedAt }]))]));
  const content = stable({ key: value.matchKey, dossier, calculationRequest: capture.calculationRequest, calculationFailures: capture.calculationFailures, projection: trajectory.projection, raw: [...capture.rawForecasts].sort((a, b) => a.kind.localeCompare(b.kind)).map(({ kind, model, endpoint, query, payload }) => ({ kind, model, endpoint, query, payload })), aviation });
  value.id = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content))), byte => byte.toString(16).padStart(2, "0")).join("");
  return value;
}

export function latestMoroccoWeatherArchive(values: SavedMoroccoWeatherArchive[], dossier: FlightDossierData, referenceAt: string): SavedMoroccoWeatherArchive | null {
  const limit = utcMs(referenceAt), key = moroccoWeatherMatchKey(dossier);
  if (!Number.isFinite(limit)) return null;
  return values.filter(value => {
    try { return value.version === 2 && value.matchKey === key && moroccoWeatherMatchKey(value.dossier) === key &&
      value.weather.traceId === dossier.traceId && value.weather.weatherModel === dossier.model.providerModelId &&
      value.trajectory.traceId === dossier.traceId && value.trajectory.moroccoPreparationIdentity === dossier.moroccoPreparationIdentity && stable(value.trajectory.projection.points) === stable(value.dossier.points) && stable(value.dossier.points) === stable(dossier.points) &&
      Number.isFinite(utcMs(value.storedAt)) && utcMs(value.storedAt) <= limit && utcMs(value.receivedAt) <= utcMs(value.storedAt) &&
      archiveSourceTimes(value).every(time => Number.isFinite(utcMs(time)) && utcMs(time) <= utcMs(value.receivedAt));
    } catch { return false; }
  })
    .sort((a, b) => utcMs(b.storedAt) - utcMs(a.storedAt) || b.id.localeCompare(a.id))[0] ?? null;
}

/** Separate scoped database: never enrolled in cloud sync, append-only versions and commit receipts. */
export class IndexedDbMoroccoWeatherArchive implements MoroccoWeatherArchiveStore {
  private scope: LocalDataScope;
  private generation: number;
  private factory: IDBFactory | undefined;
  constructor(scope: LocalDataScope, generation = getRuntimeDataScopeGeneration(), factory: IDBFactory | undefined = typeof indexedDB === "undefined" ? undefined : indexedDB) {
    this.scope = scope; this.generation = generation; this.factory = factory;
  }
  private checkScope() {
    if (getRuntimeDataScope() !== this.scope || getRuntimeDataScopeGeneration() !== this.generation) throw new Error("Compte local modifié pendant la sauvegarde météo Maroc.");
  }
  private open(): Promise<IDBDatabase> {
    this.checkScope();
    if (!this.factory) return Promise.reject(new Error("IndexedDB indisponible : préparation Maroc non sauvegardée localement."));
    return new Promise((resolve, reject) => {
      const request = this.factory!.open(scopedIndexedDbName(this.scope, DB), 1);
      let abandoned = false;
      request.onupgradeneeded = () => {
        const versions = request.result.createObjectStore("versions", { keyPath: "id" });
        versions.createIndex("matchKey", "matchKey");
        request.result.createObjectStore("receipts", { keyPath: "id" });
      };
      request.onerror = () => reject(request.error ?? new Error("Ouverture IndexedDB impossible."));
      request.onblocked = () => { abandoned = true; reject(new Error("Archive météo Maroc bloquée par un autre onglet.")); };
      request.onsuccess = () => { if (abandoned) request.result.close(); else resolve(request.result); };
    });
  }
  async saveOnce(value: MoroccoWeatherArchive): Promise<void> {
    const db = await this.open();
    try {
      this.checkScope();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("versions", "readwrite"), store = tx.objectStore("versions");
        const existing = store.get(value.id);
        existing.onsuccess = () => { if (!existing.result) store.add(value); };
        tx.oncomplete = () => resolve();
        tx.onabort = tx.onerror = () => reject(tx.error ?? new Error("Sauvegarde météo Maroc échouée."));
      });
      // Stamp only AFTER the immutable version transaction has really committed.
      const storedAt = new Date().toISOString();
      if (utcMs(storedAt) < utcMs(value.receivedAt)) throw new Error("Horloge locale incohérente : réception postérieure à l’enregistrement météo Maroc.");
      this.checkScope();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("receipts", "readwrite"), store = tx.objectStore("receipts");
        const existing = store.get(value.id);
        existing.onsuccess = () => { if (!existing.result) store.add({ id: value.id, storedAt }); };
        tx.oncomplete = () => resolve();
        tx.onabort = tx.onerror = () => reject(tx.error ?? new Error("Confirmation de sauvegarde météo Maroc échouée."));
      });
      this.checkScope();
    } finally { db.close(); }
  }
  async matching(key: string): Promise<SavedMoroccoWeatherArchive[]> {
    const db = await this.open();
    try {
      this.checkScope();
      const values = await new Promise<SavedMoroccoWeatherArchive[]>((resolve, reject) => {
        const tx = db.transaction(["versions", "receipts"], "readonly"), results: SavedMoroccoWeatherArchive[] = [];
        const request = tx.objectStore("versions").index("matchKey").getAll(key);
        request.onsuccess = () => { for (const value of request.result as MoroccoWeatherArchive[]) {
          const receipt = tx.objectStore("receipts").get(value.id);
          receipt.onsuccess = () => { if (receipt.result) results.push({ ...value, storedAt: receipt.result.storedAt }); };
        } };
        tx.oncomplete = () => resolve(results);
        tx.onabort = tx.onerror = () => reject(tx.error ?? new Error("Lecture des préparations Maroc impossible."));
      });
      this.checkScope();
      return values;
    } finally { db.close(); }
  }
}

export function currentMoroccoWeatherArchiveStore(): MoroccoWeatherArchiveStore {
  const scope = getRuntimeDataScope();
  if (!scope) throw new Error("Compte local non initialisé : archive météo Maroc indisponible.");
  return new IndexedDbMoroccoWeatherArchive(scope);
}

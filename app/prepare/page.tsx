"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { analysisPathWithLoadDemo } from "../lib/loadPerformance/demoMode";
import {
  CalendarDays,
  ChevronRight,
  Clock3,
  Timer,
  X,
} from "lucide-react";
import NavigationBar from "../components/NavigationBar";
import BalloonSelector from "../components/prepare/BalloonSelector";
import { useBalloons } from "../hooks/useBalloons";
import LaunchPointMapDialog from "../components/prepare/LaunchPointMapDialog";
import TerrainSelector from "../components/prepare/TerrainSelector";
import {
  PREPARATION_STORAGE_VERSION,
  type StoredFlightPreparationV2,
} from "../lib/flightStorage";
import {
  loadPreparationDraft,
  savePreparationDraft,
} from "../lib/preparationDraftStorage";
import {
  combineLocalDateAndTime,
  DEFAULT_ALTITUDE_OPTIONS,
  durationMinutesToSeconds,
  optionalVerticalRate,
  WEATHER_MODEL_REGISTRY,
  type GeocodingResult,
  type TrajectoryFormState,
  type MultiAltitudeProjectionRequest,
  type NumericAltitudeOption,
} from "../lib/trajectory/integration";
import { saveTrajectoryAnalysisRequest } from "../lib/trajectory/projectionStorage";
import { addFavoriteLaunchSite, loadFavoriteLaunchSites, removeFavoriteLaunchSite, saveFavoriteLaunchSites, updateFavoriteLaunchSite, type FavoriteLaunchSite } from "../lib/favoriteLaunchSites";
import { normalizeTimeInput, validDurationMinutes } from "../lib/preparationInputs";

const DURATION_PRESETS = [30, 45, 60, 75, 90] as const;
function localDateParts(value: string | null): { date: string; time: string } {
  if (!value) return { date: "", time: "" };
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return { date: "", time: "" };
  return {
    date: `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(
      2,
      "0",
    )}-${String(parsed.getDate()).padStart(2, "0")}`,
    time: `${String(parsed.getHours()).padStart(2, "0")}:${String(
      parsed.getMinutes(),
    ).padStart(2, "0")}`,
  };
}

function initialForm(): TrajectoryFormState {
  return {
    launchSite: null,
    launchSearch: "",
    date: "",
    time: "",
    durationMinutes: "",
    targetAltitudeAmslM: "",
    selectedAltitudes: [...DEFAULT_ALTITUDE_OPTIONS],
    weatherModel: "arome_seamless",
    climbRateMps: "0",
    descentRateMps: "0",
    balloonName: "",
    occupantsWeightKg: "",
  };
}

function parseNumber(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function preparationSnapshot(
  form: TrajectoryFormState,
  previous: StoredFlightPreparationV2 | null,
  now: number,
): StoredFlightPreparationV2 {
  const duration = parseNumber(form.durationMinutes);
  const altitude = parseNumber(form.targetAltitudeAmslM);
  const climbRate = parseNumber(form.climbRateMps);
  const descentRate = parseNumber(form.descentRateMps);
  const occupantsWeight = parseNumber(form.occupantsWeightKg);
  return {
    storageVersion: PREPARATION_STORAGE_VERSION,
    launchSite: form.launchSite
      ? {
          name: form.launchSite.name,
          latitude: form.launchSite.latitude,
          longitude: form.launchSite.longitude,
        }
      : null,
    ...(!form.launchSite && form.launchSearch.trim()
      ? { unresolvedLaunchSiteName: form.launchSearch.trim() }
      : {}),
    departureTime: combineLocalDateAndTime(form.date, form.time),
    durationMinutes: duration !== null && duration > 0 ? duration : null,
    weatherModel: form.weatherModel,
    targetAltitudeAmslM:
      altitude !== null && altitude >= 0 ? altitude : null,
    selectedAltitudes: form.selectedAltitudes,
    ...(altitude !== null &&
    form.selectedAltitudes.includes(altitude as NumericAltitudeOption)
      ? { primaryAltitudeAmslM: altitude }
      : {}),
    ...(climbRate !== null && climbRate > 0 ? { climbRateMps: climbRate } : {}),
    ...(descentRate !== null && descentRate > 0
      ? { descentRateMps: descentRate }
      : {}),
    ...(form.balloonName.trim()
      ? { balloonName: form.balloonName.trim() }
      : {}),
    ...(form.balloonName && occupantsWeight !== null && occupantsWeight > 0
      ? { occupantsWeightKg: occupantsWeight }
      : {}),
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
  };
}

function displayPreparationDate(value: string): string {
  if (!value) return "—";
  const today = new Date();
  const parsed = new Date(`${value}T12:00:00`);
  if (
    parsed.getFullYear() === today.getFullYear() &&
    parsed.getMonth() === today.getMonth() &&
    parsed.getDate() === today.getDate()
  ) {
    return "Aujourd’hui";
  }
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "short",
  }).format(parsed);
}

function displayDuration(value: string): string {
  const minutes = Number(value);
  if (!Number.isFinite(minutes) || minutes <= 0) return "—";
  const hours = Math.floor(minutes / 60);
  const remainder = Math.round(minutes % 60);
  return hours > 0
    ? `${hours}h${String(remainder).padStart(2, "0")}`
    : `${remainder} min`;
}

export default function PreparePage() {
  const balloons = useBalloons();
  const router = useRouter();
  const [form, setForm] = useState<TrajectoryFormState>(initialForm);
  const [storageReady, setStorageReady] = useState(false);
  const [formDirty, setFormDirty] = useState(false);
  const [suggestions, setSuggestions] = useState<GeocodingResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [locating, setLocating] = useState(false);
  const [customDurationOpen, setCustomDurationOpen] = useState(false);
  const [customDuration, setCustomDuration] = useState("");
  const [timeDigits, setTimeDigits] = useState("");
  const [timeError, setTimeError] = useState<string | null>(null);
  const [favoriteTerrains, setFavoriteTerrains] = useState<FavoriteLaunchSite[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [launchPointDraft, setLaunchPointDraft] =
    useState<GeocodingResult | null>(null);
  const submissionRef = useRef(false);

  useEffect(() => {
    const stored = loadPreparationDraft();
    const timer = window.setTimeout(() => {
      if (stored) {
        const departure = localDateParts(stored.departureTime);
        setTimeDigits(departure.time.replace(":", ""));
        setForm({
          launchSite: stored.launchSite
            ? {
                id: `stored-${stored.launchSite.latitude}-${stored.launchSite.longitude}`,
                name: stored.launchSite.name,
                latitude: stored.launchSite.latitude,
                longitude: stored.launchSite.longitude,
              }
            : null,
          launchSearch:
            stored.launchSite?.name ?? stored.unresolvedLaunchSiteName ?? "",
          date: departure.date,
          time: departure.time,
          durationMinutes:
            stored.durationMinutes === null
              ? ""
              : String(stored.durationMinutes),
          targetAltitudeAmslM:
            stored.targetAltitudeAmslM === null
              ? ""
              : String(stored.targetAltitudeAmslM),
          selectedAltitudes:
            stored.selectedAltitudes?.length
              ? stored.selectedAltitudes
              : [...DEFAULT_ALTITUDE_OPTIONS],
          weatherModel: WEATHER_MODEL_REGISTRY.some(
            (model) =>
              model.providerModelId === stored.weatherModel &&
              model.supported,
          )
            ? stored.weatherModel
            : "arome_seamless",
          climbRateMps: String(stored.climbRateMps ?? 0),
          descentRateMps: String(stored.descentRateMps ?? 0),
          balloonName: stored.balloonName ?? "",
          occupantsWeightKg:
            !stored.balloonName || stored.occupantsWeightKg === undefined
              ? ""
              : String(stored.occupantsWeightKg),
        });
      }
      setFavoriteTerrains(loadFavoriteLaunchSites());
      setStorageReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!storageReady || !formDirty) return;
    const previous = loadPreparationDraft();
    const timer = window.setTimeout(() => {
      savePreparationDraft(preparationSnapshot(form, previous, Date.now()));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [form, formDirty, storageReady]);

  const update = <Key extends keyof TrajectoryFormState>(
    key: Key,
    value: TrajectoryFormState[Key],
  ) => {
    setFormDirty(true);
    setForm((current) => ({ ...current, [key]: value }));
  };

  const selectedDurationIsPreset = useMemo(
    () =>
      DURATION_PRESETS.some(
        (minutes) => String(minutes) === form.durationMinutes,
      ),
    [form.durationMinutes],
  );

  const updateTimeDigits = (value: string) => {
    const normalized = normalizeTimeInput(value);
    setTimeDigits(normalized.digits);
    setTimeError(normalized.error);
    update("time", normalized.time);
  };

  const finalizeTimeDigits = () => {
    const normalized = normalizeTimeInput(timeDigits, true);
    setTimeDigits(normalized.digits);
    setTimeError(normalized.error);
    update("time", normalized.time);
  };

  const updateFavorites = (
    updater: (current: FavoriteLaunchSite[]) => FavoriteLaunchSite[],
  ) => {
    setFavoriteTerrains((current) => {
      const next = updater(current);
      saveFavoriteLaunchSites(next);
      return next;
    });
  };

  const searchLaunchSite = async () => {
    const query = form.launchSearch.trim();
    if (query.length < 2 || searching) return;
    setSearching(true);
    setError(null);
    setSuggestions([]);
    try {
      const response = await fetch(
        `/api/geocoding/search?q=${encodeURIComponent(query)}`,
      );
      const payload: unknown = await response.json();
      if (
        !response.ok ||
        typeof payload !== "object" ||
        payload === null ||
        !("results" in payload) ||
        !Array.isArray(payload.results)
      ) {
        throw new Error("geocoding");
      }
      setSuggestions(payload.results as GeocodingResult[]);
      if (payload.results.length === 0) {
        setError("Aucun lieu trouvé. Précisez la recherche.");
      }
    } catch {
      setError("La recherche de lieu est indisponible.");
    } finally {
      setSearching(false);
    }
  };

  const useCurrentPosition = () => {
    if (!navigator.geolocation || locating) {
      setError("La géolocalisation n’est pas disponible.");
      return;
    }
    setLocating(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const site: GeocodingResult = {
          id: `gps-${coords.latitude}-${coords.longitude}`,
          name: "Ma position",
          latitude: coords.latitude,
          longitude: coords.longitude,
        };
        setForm((current) => ({
          ...current,
          launchSite: site,
          launchSearch: site.name,
        }));
        setFormDirty(true);
        setSuggestions([]);
        setLocating(false);
      },
      () => {
        setError("La position n’a pas pu être obtenue.");
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 30_000 },
    );
  };

  const buildRequest = (): MultiAltitudeProjectionRequest | null => {
    const launchDateTimeIso = combineLocalDateAndTime(form.date, form.time);
    const durationMinutes = parseNumber(form.durationMinutes);
    const altitude = parseNumber(form.targetAltitudeAmslM);
    const climbRate = Number(form.climbRateMps);
    const descentRate = Number(form.descentRateMps);
    const optionalClimbRate = optionalVerticalRate(climbRate);
    const optionalDescentRate = optionalVerticalRate(descentRate);
    if (!form.launchSite) {
      setError("Sélectionnez un point de départ.");
      return null;
    }
    if (!launchDateTimeIso) {
      setError("La date ou l’heure est invalide.");
      return null;
    }
    if (durationMinutes === null || durationMinutes <= 0) {
      setError("La durée doit être strictement positive.");
      return null;
    }
    if (form.selectedAltitudes.length === 0) {
      setError("Sélectionnez au moins une altitude.");
      return null;
    }
    const numericAltitudes = form.selectedAltitudes.filter(
      (value): value is NumericAltitudeOption => typeof value === "number",
    );
    const primaryAltitude =
      altitude !== null &&
      numericAltitudes.includes(altitude as NumericAltitudeOption)
        ? altitude
        : numericAltitudes.at(-1);
    return {
      version: 2,
      launchSite: {
        name: form.launchSite.name,
        latitude: form.launchSite.latitude,
        longitude: form.launchSite.longitude,
      },
      launchDateTimeIso,
      durationSeconds: durationMinutesToSeconds(durationMinutes),
      altitudesAmslM: form.selectedAltitudes,
      ...(primaryAltitude === undefined
        ? {}
        : { primaryAltitudeAmslM: primaryAltitude }),
      ...(optionalClimbRate === undefined
        ? {}
        : { climbRateMps: optionalClimbRate }),
      ...(optionalDescentRate === undefined
        ? {}
        : { descentRateMps: optionalDescentRate }),
      weatherModel: form.weatherModel,
    };
  };

  const submitProjection = async () => {
    if (submissionRef.current) return;
    const request = buildRequest();
    if (!request) return;
    submissionRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const storedPreparation = loadPreparationDraft();
      savePreparationDraft(
        preparationSnapshot(form, storedPreparation, Date.now()),
      );
      if (!saveTrajectoryAnalysisRequest(request)) {
        setError("Les paramètres ne peuvent pas être ouverts sur la carte.");
        return;
      }
      router.push(analysisPathWithLoadDemo());
    } catch {
      setError(
        "La projection n’a pas pu être calculée. Vérifiez la connexion et réessayez.",
      );
    } finally {
      submissionRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <main className="min-h-dvh pb-[calc(82px+env(safe-area-inset-bottom))] pt-[max(8px,env(safe-area-inset-top))]">
      <div className="mx-auto w-full max-w-3xl px-4 sm:px-6">
        <header className="mb-2">
          <p
            className="mb-1 text-[11px] font-semibold uppercase tracking-[0.2em]"
            style={{ color: "var(--bc-accent)" }}
          >
            Prépa
          </p>
          <h1 className="text-[clamp(1.75rem,7vw,2.5rem)] font-semibold tracking-[-0.035em]">
            Préparation du vol
          </h1>
          <p
            className="mt-0.5 max-w-lg text-xs leading-snug"
            style={{ color: "var(--bc-color-text-secondary)" }}
          >
            Définissez le contexte, puis ouvrez l’analyse des trajectoires.
          </p>
        </header>

        <section
          className="relative rounded-[24px] border p-3 sm:p-4"
          style={{
            background:
              "linear-gradient(145deg, var(--bc-color-surface), var(--bc-color-canvas-elevated))",
            borderColor: "var(--bc-border)",
            boxShadow: "var(--bc-shadow-panel)",
          }}
          aria-labelledby="flight-context-title"
        >
          <h2
            id="flight-context-title"
            className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em]"
            style={{ color: "var(--bc-color-text-muted)" }}
          >
            Contexte du vol
          </h2>

          <TerrainSelector
            value={form.launchSearch}
            hasSelectedTerrain={Boolean(form.launchSite)}
            suggestions={suggestions}
            searching={searching}
            locating={locating}
            onValueChange={(value) => {
              update("launchSearch", value);
              update("launchSite", null);
              setSuggestions([]);
            }}
            onSearch={() => void searchLaunchSite()}
            onLocate={useCurrentPosition}
            favoriteTerrains={favoriteTerrains}
            selectedTerrain={form.launchSite}
            onAddFavorite={(terrain, displayName) => {
              const duplicate = favoriteTerrains.find((favorite) =>
                Math.abs(favorite.latitude - terrain.latitude) < 0.0000005 &&
                Math.abs(favorite.longitude - terrain.longitude) < 0.0000005,
              );
              if (duplicate) return `Un favori existe déjà à cet emplacement : ${duplicate.name}.`;
              const next = addFavoriteLaunchSite(favoriteTerrains, terrain, undefined, displayName);
              setFavoriteTerrains(next);
              saveFavoriteLaunchSites(next);
              return null;
            }}
            onUpdateFavorite={(favoriteId, point, displayName) => {
              const result = updateFavoriteLaunchSite(favoriteTerrains, favoriteId, {
                name: displayName,
                latitude: point.latitude,
                longitude: point.longitude,
                sourceName: point.name,
              });
              if (result.duplicate) return `Un favori existe déjà à cet emplacement : ${result.duplicate.name}.`;
              setFavoriteTerrains(result.favorites);
              saveFavoriteLaunchSites(result.favorites);
              return null;
            }}
            onRemoveFavorite={(terrain) =>
              updateFavorites((current) =>
                removeFavoriteLaunchSite(current, terrain),
              )
            }
            onSelectFavorite={(favorite) => {
              setForm((current) => ({
                ...current,
                launchSite: favorite,
                launchSearch: favorite.name,
              }));
              setFormDirty(true);
              setSuggestions([]);
            }}
            onSelectSuggestion={(suggestion) => {
              setSuggestions([]);
              setLaunchPointDraft(suggestion);
            }}
            onRequestMapSelection={() => {
              if (form.launchSite) setLaunchPointDraft(form.launchSite);
            }}
          />

          <div className="grid grid-cols-3 gap-2">
            <label
              className="relative flex min-h-16 cursor-pointer flex-col justify-between overflow-hidden rounded-2xl border p-2.5"
              style={{
                background: "rgb(255 255 255 / 3%)",
                borderColor: "var(--bc-border)",
              }}
            >
              <CalendarDays
                size={17}
                style={{ color: "var(--bc-accent)" }}
              />
              <span>
                <span
                  className="block text-[9px] font-semibold uppercase tracking-[0.12em]"
                  style={{ color: "var(--bc-color-text-muted)" }}
                >
                  Date
                </span>
                <span className="block truncate text-sm font-semibold">
                  {displayPreparationDate(form.date)}
                </span>
              </span>
              <input
                type="date"
                value={form.date}
                onChange={(event) => update("date", event.target.value)}
                className="absolute inset-0 cursor-pointer opacity-0"
                aria-label="Date"
              />
            </label>

            <label
              className="flex min-h-16 cursor-text flex-col justify-between rounded-2xl border p-2.5 text-left"
              style={{
                background: "rgb(255 255 255 / 3%)",
                borderColor: timeError
                  ? "var(--bc-danger)"
                  : "var(--bc-border)",
              }}
            >
              <Clock3
                size={17}
                className="pointer-events-none"
                style={{ color: "var(--bc-accent)" }}
              />
              <span>
                <span
                  className="block text-[9px] font-semibold uppercase tracking-[0.12em]"
                  style={{ color: "var(--bc-color-text-muted)" }}
                >
                  Heure
                </span>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoComplete="off"
                  enterKeyHint="next"
                  maxLength={5}
                  value={
                    timeDigits.length === 4
                      ? `${timeDigits.slice(0, 2)}:${timeDigits.slice(2, 4)}`
                      : timeDigits
                  }
                  onChange={(event) => updateTimeDigits(event.target.value)}
                  onBlur={finalizeTimeDigits}
                  onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); finalizeTimeDigits(); (event.currentTarget.closest(".grid")?.querySelector("button") as HTMLButtonElement | null)?.focus(); } }}
                  onFocus={(event) => event.currentTarget.select()}
                  className="block w-full border-0 bg-transparent p-0 text-sm font-semibold outline-none"
                  placeholder="—:—"
                  aria-label="Heure du vol, quatre chiffres"
                  aria-invalid={Boolean(timeError)}
                  aria-describedby={timeError ? "time-error" : undefined}
                />
              </span>
            </label>
            <button
              type="button"
              onClick={() => {
                setCustomDuration(form.durationMinutes);
                setCustomDurationOpen(true);
              }}
              className="flex min-h-16 flex-col justify-between rounded-2xl border p-2.5 text-left"
              style={{
                background: "rgb(255 255 255 / 3%)",
                borderColor:
                  !form.durationMinutes || selectedDurationIsPreset
                  ? "var(--bc-border)"
                  : "var(--bc-accent)",
              }}
            >
              <Timer size={17} style={{ color: "var(--bc-accent)" }} />
              <span>
                <span
                  className="block text-[9px] font-semibold uppercase tracking-[0.12em]"
                  style={{ color: "var(--bc-color-text-muted)" }}
                >
                  Durée
                </span>
                <span className="block text-sm font-semibold">
                  {displayDuration(form.durationMinutes)}
                </span>
              </span>
            </button>
          </div>
          {timeError && (
            <p
              id="time-error"
              className="mt-1.5 text-[10px] font-semibold"
              style={{ color: "var(--bc-danger)" }}
            >
              {timeError}
            </p>
          )}

        </section>

        <div className="mt-2">
          <BalloonSelector
            balloons={balloons}
            selectedBalloonId={
              balloons.some(
                (balloon) => balloon.id === form.balloonName,
              )
                ? form.balloonName
                : ""
            }
            onChange={(balloonId) => {
              setFormDirty(true);
              setForm((current) => ({
                ...current,
                balloonName: balloonId,
                occupantsWeightKg: balloonId
                  ? current.occupantsWeightKg
                  : "",
              }));
            }}
          />
        </div>

        <section
          className="mt-2 rounded-[24px] border p-3 transition-opacity sm:p-4"
          style={{
            background: "var(--bc-surface)",
            borderColor: "var(--bc-border)",
            opacity: form.balloonName ? 1 : 0.5,
          }}
          aria-labelledby="charge-title"
        >
          <h2
            id="charge-title"
            className={`${form.balloonName ? "mb-2" : "mb-1"} text-[10px] font-semibold uppercase tracking-[0.16em]`}
            style={{ color: "var(--bc-color-text-muted)" }}
          >
            Charge
          </h2>
          {form.balloonName && <label className="flex min-h-14 items-center justify-between gap-4 rounded-2xl border px-3">
            <span>
              <span className="block text-sm font-semibold">
                Pilote + passagers
              </span>
              <span
                className="mt-0.5 block text-xs"
                style={{ color: "var(--bc-color-text-secondary)" }}
              >
                Toutes les personnes embarquées
              </span>
            </span>
            <span className="flex shrink-0 items-baseline gap-1">
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                disabled={!form.balloonName}
                value={form.occupantsWeightKg}
                onChange={(event) =>
                  update(
                    "occupantsWeightKg",
                    event.target.value.replace(/\D/g, ""),
                  )
                }
                className="w-20 border-0 bg-transparent p-0 text-right text-xl font-semibold outline-none disabled:cursor-not-allowed"
                placeholder="—"
                aria-label="Poids total du pilote et des passagers en kilogrammes"
              />
              <span
                className="text-sm"
                style={{ color: "var(--bc-color-text-muted)" }}
              >
                kg
              </span>
            </span>
          </label>}
          {!form.balloonName && (
            <p
              className="text-xs leading-snug"
              style={{ color: "var(--bc-color-text-muted)" }}
            >
              Sélectionnez un ballon pour calculer la charge.
            </p>
          )}
        </section>

        {error && (
          <p
            role="alert"
            className="mt-5 rounded-2xl border px-4 py-3 text-sm font-semibold"
            style={{
              borderColor: "var(--bc-danger)",
              color: "var(--bc-danger)",
            }}
          >
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={() => void submitProjection()}
          disabled={submitting}
          className="mt-3 flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl px-4 text-base font-semibold transition-[transform,background-color] active:scale-[0.99] disabled:opacity-60"
          style={{
            background: "var(--bc-accent)",
            color: "var(--bc-accent-foreground)",
            boxShadow: "var(--bc-shadow-action)",
          }}
        >
          {submitting ? "Ouverture de l’analyse…" : "Ouvrir l’analyse"}
          {!submitting && <ChevronRight size={19} />}
        </button>
        <p
          className="mt-2 text-center text-[11px]"
          style={{ color: "var(--bc-color-text-muted)" }}
        >
          Projection indicative — la décision reste celle du pilote.
        </p>

      </div>

      <NavigationBar activeItem="Prépa" />

      {customDurationOpen && (
        <div className="fixed inset-0 z-[80] flex items-end bg-black/60 p-3">
          <section
            className="mx-auto w-full max-w-md rounded-2xl border p-4 pb-[max(16px,env(safe-area-inset-bottom))]"
            style={{
              background: "var(--bc-background-elevated)",
              borderColor: "var(--bc-border)",
            }}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-black">Durée personnalisée</h2>
              <button
                type="button"
                onClick={() => setCustomDurationOpen(false)}
                className="flex h-11 w-11 items-center justify-center rounded-full"
                aria-label="Fermer"
              >
                <X size={20} />
              </button>
            </div>
            <input
              autoFocus
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="off"
              enterKeyHint="done"
              value={customDuration}
              onChange={(event) =>
                setCustomDuration(event.target.value.replace(/\D/g, ""))
              }
              className="mt-2 h-12 w-full rounded-xl border px-3 text-lg font-bold"
              aria-label="Durée personnalisée en minutes"
            />
            <button
              type="button"
              onClick={() => {
                const value = parseNumber(customDuration);
                if (validDurationMinutes(customDuration) && value !== null) {
                  update("durationMinutes", String(value));
                  setCustomDurationOpen(false);
                }
              }}
              className="mt-3 min-h-12 w-full rounded-xl font-black"
              style={{
                background: "var(--bc-accent)",
                color: "var(--bc-accent-foreground)",
              }}
            >
              Valider
            </button>
          </section>
        </div>
      )}

      {launchPointDraft && (
        <LaunchPointMapDialog
          initialPoint={launchPointDraft}
          onCancel={() => setLaunchPointDraft(null)}
          onConfirm={(point) => {
            setForm((current) => ({
              ...current,
              launchSite: point,
              launchSearch: point.name,
            }));
            setFormDirty(true);
            setLaunchPointDraft(null);
          }}
        />
      )}
    </main>
  );
}

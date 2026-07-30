"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarDays,
  Check,
  ChevronRight,
  Clock3,
  LocateFixed,
  MapPin,
  Search,
  Timer,
  X,
} from "lucide-react";
import NavigationBar from "../components/NavigationBar";
import {
  getFlightPreparation,
  PREPARATION_STORAGE_VERSION,
  saveFlightPreparation,
} from "../lib/flightStorage";
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
    durationMinutes: "60",
    targetAltitudeAmslM: "",
    selectedAltitudes: [...DEFAULT_ALTITUDE_OPTIONS],
    weatherModel: "arome_seamless",
    climbRateMps: "0",
    descentRateMps: "0",
    balloonName: "",
    passengerWeightKg: "",
  };
}

function parseNumber(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function displayPreparationDate(value: string): string {
  if (!value) return "Aujourd’hui";
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
  const router = useRouter();
  const [form, setForm] = useState<TrajectoryFormState>(initialForm);
  const [storageReady, setStorageReady] = useState(false);
  const [suggestions, setSuggestions] = useState<GeocodingResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [locating, setLocating] = useState(false);
  const [customDurationOpen, setCustomDurationOpen] = useState(false);
  const [customDuration, setCustomDuration] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submissionRef = useRef(false);

  useEffect(() => {
    const stored = getFlightPreparation();
    const timer = window.setTimeout(() => {
      if (stored) {
        const departure = localDateParts(stored.departureTime);
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
          durationMinutes: String(stored.durationMinutes ?? 60),
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
          passengerWeightKg:
            stored.passengerWeightKg === undefined
              ? ""
              : String(stored.passengerWeightKg),
        });
      } else {
        const now = new Date();
        setForm((current) => ({
          ...current,
          date: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(
            2,
            "0",
          )}-${String(now.getDate()).padStart(2, "0")}`,
          time: `${String(now.getHours()).padStart(2, "0")}:${String(
            now.getMinutes(),
          ).padStart(2, "0")}`,
        }));
      }
      setStorageReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!storageReady) return;
    const previous = getFlightPreparation();
    const duration = parseNumber(form.durationMinutes);
    const altitude = parseNumber(form.targetAltitudeAmslM);
    const climbRate = parseNumber(form.climbRateMps);
    const descentRate = parseNumber(form.descentRateMps);
    const passengerWeight = parseNumber(form.passengerWeightKg);
    const timer = window.setTimeout(() => {
      saveFlightPreparation({
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
        durationMinutes:
          duration !== null && duration > 0 ? duration : null,
        weatherModel: form.weatherModel,
        targetAltitudeAmslM:
          altitude !== null && altitude >= 0 ? altitude : null,
        selectedAltitudes: form.selectedAltitudes,
        ...(altitude !== null &&
        form.selectedAltitudes.includes(altitude as NumericAltitudeOption)
          ? { primaryAltitudeAmslM: altitude }
          : {}),
        ...(climbRate !== null && climbRate > 0
          ? { climbRateMps: climbRate }
          : {}),
        ...(descentRate !== null && descentRate > 0
          ? { descentRateMps: descentRate }
          : {}),
        ...(form.balloonName.trim()
          ? { balloonName: form.balloonName.trim() }
          : {}),
        ...(passengerWeight !== null && passengerWeight >= 0
          ? { passengerWeightKg: passengerWeight }
          : {}),
        createdAt: previous?.createdAt ?? Date.now(),
        updatedAt: Date.now(),
      });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [form, storageReady]);

  const update = <Key extends keyof TrajectoryFormState>(
    key: Key,
    value: TrajectoryFormState[Key],
  ) => setForm((current) => ({ ...current, [key]: value }));

  const selectedDurationIsPreset = useMemo(
    () =>
      DURATION_PRESETS.some(
        (minutes) => String(minutes) === form.durationMinutes,
      ),
    [form.durationMinutes],
  );

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
      const passengerWeight = parseNumber(form.passengerWeightKg);
      const storedPreparation = getFlightPreparation();
      if (storedPreparation) {
        saveFlightPreparation({
          ...storedPreparation,
          passengerWeightKg:
            passengerWeight !== null && passengerWeight >= 0
              ? passengerWeight
              : undefined,
          updatedAt: Date.now(),
        });
      }
      if (!saveTrajectoryAnalysisRequest(request)) {
        setError("Les paramètres ne peuvent pas être ouverts sur la carte.");
        return;
      }
      router.push("/map");
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
    <main className="min-h-dvh pb-[calc(92px+env(safe-area-inset-bottom))] pt-[max(18px,env(safe-area-inset-top))]">
      <div className="mx-auto w-full max-w-3xl px-4 sm:px-6">
        <header className="mb-6">
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
            className="mt-2 max-w-lg text-sm leading-relaxed"
            style={{ color: "var(--bc-color-text-secondary)" }}
          >
            Définissez le contexte, puis ouvrez l’analyse des trajectoires.
          </p>
        </header>

        <section
          className="relative rounded-[28px] border p-4 sm:p-5"
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
            className="mb-4 text-xs font-semibold uppercase tracking-[0.16em]"
            style={{ color: "var(--bc-color-text-muted)" }}
          >
            Contexte du vol
          </h2>

          <div className="relative mb-3">
            <div className="flex gap-2">
              <label
                className="flex min-h-16 min-w-0 flex-1 items-center gap-3 rounded-2xl border px-3"
                style={{
                  background: "rgb(255 255 255 / 3%)",
                  borderColor: "var(--bc-border)",
                }}
              >
                <MapPin size={19} style={{ color: "var(--bc-accent)" }} />
                <span className="min-w-0 flex-1">
                  <span
                    className="block text-[10px] font-semibold uppercase tracking-[0.12em]"
                    style={{ color: "var(--bc-color-text-muted)" }}
                  >
                    Terrain
                  </span>
                  <input
                    value={form.launchSearch}
                    onChange={(event) => {
                      update("launchSearch", event.target.value);
                      update("launchSite", null);
                      setSuggestions([]);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void searchLaunchSite();
                    }}
                    className="mt-0.5 w-full truncate border-0 bg-transparent p-0 text-base font-semibold outline-none"
                    placeholder="Bondues"
                    aria-label="Rechercher un terrain"
                  />
                </span>
              </label>
              <button
                type="button"
                onClick={() => void searchLaunchSite()}
                disabled={searching}
                className="flex h-16 w-12 shrink-0 items-center justify-center rounded-2xl border"
                style={{ borderColor: "var(--bc-border)" }}
                aria-label="Rechercher le terrain"
              >
                <Search size={18} />
              </button>
              <button
                type="button"
                onClick={useCurrentPosition}
                disabled={locating}
                className="flex h-16 w-12 shrink-0 items-center justify-center rounded-2xl border"
                style={{ borderColor: "var(--bc-border)" }}
                aria-label="Utiliser ma position"
              >
                {form.launchSite ? (
                  <Check size={19} style={{ color: "var(--bc-success)" }} />
                ) : (
                  <LocateFixed size={19} />
                )}
              </button>
            </div>
            {suggestions.length > 0 && (
              <div
                className="absolute left-0 right-0 top-full z-50 mt-2 max-h-56 overflow-y-auto rounded-2xl border p-2 shadow-2xl"
                style={{
                  background: "var(--bc-background-elevated)",
                  borderColor: "var(--bc-border)",
                }}
              >
                {suggestions.map((suggestion) => (
                  <button
                    key={suggestion.id}
                    type="button"
                    onClick={() => {
                      setForm((current) => ({
                        ...current,
                        launchSite: suggestion,
                        launchSearch: suggestion.name,
                      }));
                      setSuggestions([]);
                    }}
                    className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-semibold"
                  >
                    <MapPin size={16} className="shrink-0" />
                    <span className="line-clamp-2">{suggestion.name}</span>
                  </button>
                ))}
                <p
                  className="px-3 py-1 text-[10px]"
                  style={{ color: "var(--bc-color-text-muted)" }}
                >
                  © OpenStreetMap contributors
                </p>
              </div>
            )}
          </div>

          <div className="grid grid-cols-3 gap-2">
            {[
              {
                label: "Date",
                value: displayPreparationDate(form.date),
                icon: CalendarDays,
                inputType: "date",
                inputValue: form.date,
                onChange: (value: string) => update("date", value),
              },
              {
                label: "Heure",
                value: form.time || "06:30",
                icon: Clock3,
                inputType: "time",
                inputValue: form.time,
                onChange: (value: string) => update("time", value),
              },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <label
                  key={item.label}
                  className="relative flex min-h-20 cursor-pointer flex-col justify-between overflow-hidden rounded-2xl border p-3"
                  style={{
                    background: "rgb(255 255 255 / 3%)",
                    borderColor: "var(--bc-border)",
                  }}
                >
                  <Icon size={17} style={{ color: "var(--bc-accent)" }} />
                  <span>
                    <span
                      className="block text-[9px] font-semibold uppercase tracking-[0.12em]"
                      style={{ color: "var(--bc-color-text-muted)" }}
                    >
                      {item.label}
                    </span>
                    <span className="block truncate text-sm font-semibold">
                      {item.value}
                    </span>
                  </span>
                  <input
                    type={item.inputType}
                    value={item.inputValue}
                    onChange={(event) => item.onChange(event.target.value)}
                    className="absolute inset-0 cursor-pointer opacity-0"
                    aria-label={item.label}
                  />
                </label>
              );
            })}
            <button
              type="button"
              onClick={() => {
                setCustomDuration(form.durationMinutes);
                setCustomDurationOpen(true);
              }}
              className="flex min-h-20 flex-col justify-between rounded-2xl border p-3 text-left"
              style={{
                background: "rgb(255 255 255 / 3%)",
                borderColor: selectedDurationIsPreset
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

          <label
            className="mt-3 flex min-h-16 items-center justify-between gap-4 rounded-2xl border px-4"
            style={{
              background: "rgb(255 255 255 / 3%)",
              borderColor: "var(--bc-border)",
            }}
          >
            <span>
              <span
                className="block text-[10px] font-semibold uppercase tracking-[0.12em]"
                style={{ color: "var(--bc-color-text-muted)" }}
              >
                Poids total embarqué
              </span>
              <span
                className="mt-0.5 block text-xs"
                style={{ color: "var(--bc-color-text-secondary)" }}
              >
                Passagers uniquement
              </span>
            </span>
            <span className="flex shrink-0 items-baseline gap-1">
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="1"
                value={form.passengerWeightKg}
                onChange={(event) =>
                  update("passengerWeightKg", event.target.value)
                }
                className="w-20 border-0 bg-transparent p-0 text-right text-xl font-semibold outline-none"
                placeholder="0"
                aria-label="Poids total des passagers en kilogrammes"
              />
              <span
                className="text-sm"
                style={{ color: "var(--bc-color-text-muted)" }}
              >
                kg
              </span>
            </span>
          </label>

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
          className="mt-5 flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl px-4 text-base font-semibold transition-[transform,background-color] active:scale-[0.99] disabled:opacity-60"
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
              inputMode="decimal"
              value={customDuration}
              onChange={(event) => setCustomDuration(event.target.value)}
              className="mt-2 h-12 w-full rounded-xl border px-3 text-lg font-bold"
              aria-label="Durée personnalisée en minutes"
            />
            <button
              type="button"
              onClick={() => {
                const value = parseNumber(customDuration);
                if (value !== null && value > 0) {
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
    </main>
  );
}

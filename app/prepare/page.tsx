"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, LocateFixed, MapPin, Search, X } from "lucide-react";
import NavigationBar from "../components/NavigationBar";
import {
  getFlightPreparation,
  PREPARATION_STORAGE_VERSION,
  saveFlightPreparation,
} from "../lib/flightStorage";
import {
  combineLocalDateAndTime,
  ALTITUDE_OPTIONS,
  DEFAULT_ALTITUDE_OPTIONS,
  altitudeLabel,
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
  };
}

function parseNumber(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function displayRate(value: string): string {
  return Number(value).toLocaleString("fr-FR", {
    maximumFractionDigits: 1,
  });
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
    <main className="h-dvh overflow-hidden px-3 pb-[calc(76px+env(safe-area-inset-bottom))] pt-[max(8px,env(safe-area-inset-top))]">
      <div className="relative mx-auto flex h-full w-full max-w-md flex-col gap-1.5">
        <header className="flex h-8 shrink-0 items-baseline gap-2">
          <p
            className="text-[10px] font-black uppercase tracking-[0.18em]"
            style={{ color: "var(--bc-accent)" }}
          >
            Prépa
          </p>
          <h1 className="text-xl font-black tracking-tight">Projection</h1>
        </header>

        <section
          className="relative shrink-0 rounded-xl border p-2"
          style={{
            background: "var(--bc-surface)",
            borderColor: "var(--bc-border)",
          }}
        >
          <div className="flex gap-1.5">
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
              className="h-11 min-w-0 flex-1 truncate rounded-lg border px-3 text-sm font-bold outline-none focus:border-[var(--bc-accent)]"
              placeholder="Point de départ"
              aria-label="Rechercher un point de départ"
            />
            <button
              type="button"
              onClick={() => void searchLaunchSite()}
              disabled={searching}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg"
              style={{
                background: "var(--bc-accent)",
                color: "var(--bc-accent-foreground)",
              }}
              aria-label="Rechercher le lieu"
            >
              <Search size={18} />
            </button>
            <button
              type="button"
              onClick={useCurrentPosition}
              disabled={locating}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border"
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
              className="absolute left-0 right-0 top-full z-50 mt-1 max-h-56 overflow-y-auto rounded-xl border p-1.5 shadow-2xl"
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
                  className="flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-left text-xs font-bold"
                >
                  <MapPin size={15} className="shrink-0" />
                  <span className="line-clamp-2">{suggestion.name}</span>
                </button>
              ))}
              <p
                className="px-2 py-1 text-[9px]"
                style={{ color: "var(--bc-text-muted)" }}
              >
                © OpenStreetMap contributors
              </p>
            </div>
          )}
        </section>

        <section className="grid shrink-0 grid-cols-2 gap-1.5">
          <label className="text-[10px] font-black uppercase">
            Date
            <input
              type="date"
              value={form.date}
              onChange={(event) => update("date", event.target.value)}
              className="mt-0.5 h-10 w-full rounded-lg border px-2 text-sm font-bold"
            />
          </label>
          <label className="text-[10px] font-black uppercase">
            Heure
            <input
              type="time"
              value={form.time}
              onChange={(event) => update("time", event.target.value)}
              className="mt-0.5 h-10 w-full rounded-lg border px-2 text-sm font-bold"
            />
          </label>
        </section>

        <section className="shrink-0">
          <p className="mb-0.5 text-[10px] font-black uppercase">Durée</p>
          <div className="grid grid-cols-6 gap-1">
            {DURATION_PRESETS.map((minutes) => (
              <button
                key={minutes}
                type="button"
                onClick={() => update("durationMinutes", String(minutes))}
                className="h-9 rounded-lg border text-[11px] font-black"
                style={{
                  borderColor:
                    form.durationMinutes === String(minutes)
                      ? "var(--bc-accent)"
                      : "var(--bc-border)",
                  background:
                    form.durationMinutes === String(minutes)
                      ? "rgb(245 158 66 / 14%)"
                      : "var(--bc-surface)",
                }}
              >
                {minutes}
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                setCustomDuration(form.durationMinutes);
                setCustomDurationOpen(true);
              }}
              className="h-9 rounded-lg border text-sm font-black"
              style={{
                borderColor: selectedDurationIsPreset
                  ? "var(--bc-border)"
                  : "var(--bc-accent)",
              }}
              aria-label="Durée personnalisée"
            >
              {selectedDurationIsPreset ? "+" : form.durationMinutes}
            </button>
          </div>
        </section>

        <section className="grid shrink-0 grid-cols-[1fr_118px] gap-1.5">
          <div>
            <p className="text-[10px] font-black uppercase">Altitudes AMSL</p>
            <div className="mt-0.5 grid grid-cols-5 gap-1">
              {ALTITUDE_OPTIONS.map((option) => {
                const selected = form.selectedAltitudes.includes(option);
                return (
                  <button
                    key={String(option)}
                    type="button"
                    aria-pressed={selected}
                    onClick={() =>
                      update(
                        "selectedAltitudes",
                        selected
                          ? form.selectedAltitudes.filter(
                              (current) => current !== option,
                            )
                          : [...form.selectedAltitudes, option],
                      )
                    }
                    className="h-8 rounded-lg border text-[10px] font-black"
                    style={{
                      borderColor: selected
                        ? "var(--bc-accent)"
                        : "var(--bc-border)",
                      background: selected
                        ? "rgb(245 158 66 / 16%)"
                        : "var(--bc-surface)",
                    }}
                  >
                    {option === "ground" ? "Sol" : option}
                  </button>
                );
              })}
            </div>
            <p className="mt-0.5 text-[9px] text-[var(--bc-text-muted)]">
              Sol = altitude terrain, vent 10 m AGL approximé.
            </p>
          </div>
          <label className="text-[10px] font-black uppercase">
            Modèle
            <select
              value={form.weatherModel}
              onChange={(event) => update("weatherModel", event.target.value)}
              className="mt-0.5 h-10 w-full rounded-lg border px-2 text-sm font-bold"
            >
              {WEATHER_MODEL_REGISTRY.map((model) => (
                <option
                  key={model.id}
                  value={model.providerModelId}
                  disabled={!model.supported}
                >
                  {model.label}
                  {model.supported ? "" : " — indisponible"}
                </option>
              ))}
            </select>
            <span className="mt-1 block">
              Profil
              <select
                value={form.targetAltitudeAmslM}
                onChange={(event) =>
                  update("targetAltitudeAmslM", event.target.value)
                }
                className="mt-0.5 h-9 w-full rounded-lg border px-1 text-xs font-bold"
                aria-label="Altitude principale du profil de vol"
              >
                <option value="">Aucun</option>
                {form.selectedAltitudes
                  .filter(
                    (option): option is NumericAltitudeOption =>
                      typeof option === "number",
                  )
                  .map((option) => (
                    <option key={option} value={option}>
                      {altitudeLabel(option)}
                    </option>
                  ))}
              </select>
            </span>
          </label>
        </section>

        <section
          className="grid shrink-0 gap-1 rounded-xl border px-2.5 py-1.5"
          style={{
            background: "var(--bc-surface)",
            borderColor: "var(--bc-border)",
          }}
        >
          {[
            {
              key: "climbRateMps" as const,
              label: "Montée",
              value: form.climbRateMps,
            },
            {
              key: "descentRateMps" as const,
              label: "Descente",
              value: form.descentRateMps,
            },
          ].map((slider) => (
            <label key={slider.key} className="block">
              <span className="flex items-center justify-between text-xs font-black">
                <span>
                  {slider.label} — {displayRate(slider.value)} m/s
                </span>
                <span
                  className="text-[9px]"
                  style={{ color: "var(--bc-text-muted)" }}
                >
                  0 · 7 m/s
                </span>
              </span>
              <input
                type="range"
                min="0"
                max="7"
                step="0.5"
                value={slider.value}
                onChange={(event) => update(slider.key, event.target.value)}
                className="h-7 w-full accent-[var(--bc-accent)]"
                aria-label={`${slider.label}, de 0 à 7 mètres par seconde`}
              />
            </label>
          ))}
        </section>

        {error && (
          <p
            role="alert"
            className="shrink-0 rounded-lg border px-2 py-1 text-[11px] font-bold leading-tight"
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
          className="mt-auto min-h-12 w-full shrink-0 rounded-xl px-4 text-base font-black disabled:opacity-60"
          style={{
            background: "var(--bc-accent)",
            color: "var(--bc-accent-foreground)",
            boxShadow: "var(--bc-shadow-action)",
          }}
        >
          {submitting ? "Calcul de la projection…" : "Voir la projection"}
        </button>
        <p
          className="shrink-0 text-center text-[9px] leading-3"
          style={{ color: "var(--bc-text-muted)" }}
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

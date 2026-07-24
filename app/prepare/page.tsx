"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Balloon,
  CalendarDays,
  Check,
  ChevronRight,
  Clock3,
  CloudSun,
  Layers,
  MapPin,
  Route,
  Scale,
  Timer,
  X,
  type LucideIcon,
} from "lucide-react";
import NavigationBar from "../components/NavigationBar";
import { getCurrentFlight, saveCurrentFlight } from "../lib/flightStorage";

type PreparationData = {
  terrain: string;
  date: string;
  heure: string;
  duree: string;
  ballon: string;
  meteo: string;
};

type PreparationField = keyof PreparationData;

type SelectorDefinition = {
  field: PreparationField;
  icon: LucideIcon;
  label: string;
};

const INITIAL_PREPARATION: PreparationData = {
  terrain: "Bondues",
  date: "",
  heure: "06:15",
  duree: "45 min",
  ballon: "Cameron Z-105",
  meteo: "AROME",
};

const PREPARATION_FIELDS: SelectorDefinition[] = [
  { field: "terrain", icon: MapPin, label: "Terrain" },
  { field: "date", icon: CalendarDays, label: "Date" },
  { field: "heure", icon: Clock3, label: "Décollage" },
  { field: "duree", icon: Timer, label: "Durée prévue" },
  { field: "meteo", icon: CloudSun, label: "Modèle météo" },
  { field: "ballon", icon: Balloon, label: "Ballon" },
];

const SELECTOR_OPTIONS: Partial<Record<PreparationField, string[]>> = {
  duree: ["30 min", "45 min", "60 min", "90 min"],
  meteo: ["AROME", "ICON", "GFS"],
  ballon: ["Cameron Z-105"],
};

const VALIDATION_CARDS = [
  { icon: CloudSun, label: "Conditions météo", href: "/briefing" },
  { icon: Route, label: "Trajectoire", href: "/map" },
  { icon: Scale, label: "Charge", href: "/briefing" },
  { icon: Layers, label: "Espaces aériens", href: "/flight" },
] as const;

function formatDate(value: string): string {
  if (!value) return "Choisir une date";

  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return value;
  return `${day}/${month}/${year}`;
}

function getDisplayValue(field: PreparationField, value: string): string {
  if (field === "date") return formatDate(value);
  return value || "À renseigner";
}

export default function PreparePage() {
  const router = useRouter();
  const [preparation, setPreparation] =
    useState<PreparationData>(INITIAL_PREPARATION);
  const [activeSelector, setActiveSelector] =
    useState<SelectorDefinition | null>(null);
  const [draftValue, setDraftValue] = useState("");
  const [storageReady, setStorageReady] = useState(false);
  const [calculationState, setCalculationState] = useState<
    "calculating" | "ready" | "error"
  >("calculating");

  const isComplete = useMemo(
    () => Object.values(preparation).every((value) => value.trim().length > 0),
    [preparation],
  );

  useEffect(() => {
    const storedPreparation = getCurrentFlight();
    const timer = window.setTimeout(() => {
      if (storedPreparation) {
        setPreparation({
          terrain: storedPreparation.terrain,
          date: storedPreparation.date,
          heure: storedPreparation.heure,
          duree: storedPreparation.duree,
          ballon: storedPreparation.ballon,
          meteo: storedPreparation.meteo,
        });
      }
      setStorageReady(true);
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!storageReady) return;

    const timer = window.setTimeout(() => {
      setCalculationState(saveCurrentFlight(preparation) ? "ready" : "error");
    }, 450);

    return () => window.clearTimeout(timer);
  }, [preparation, storageReady]);

  const openSelector = (definition: SelectorDefinition) => {
    setDraftValue(preparation[definition.field]);
    setActiveSelector(definition);
  };

  const confirmSelection = () => {
    if (!activeSelector || !draftValue.trim()) return;

    setCalculationState("calculating");
    setPreparation((current) => ({
      ...current,
      [activeSelector.field]: draftValue.trim(),
    }));
    setActiveSelector(null);
  };

  const options = activeSelector
    ? SELECTOR_OPTIONS[activeSelector.field]
    : undefined;
  const ActiveSelectorIcon = activeSelector?.icon;

  return (
    <main className="min-h-dvh px-3.5 pb-24 pt-3.5 sm:px-6 sm:pt-5">
      <div className="mx-auto w-full max-w-md">
        <header className="mb-2.5">
          <p
            className="mb-0.5 text-[11px] font-bold uppercase tracking-[0.2em]"
            style={{ color: "var(--bc-accent)" }}
          >
            Prépa
          </p>
          <h1 className="text-[1.75rem] font-black leading-tight tracking-tight">
            Préparer le vol
          </h1>
        </header>

        <section aria-label="Paramètres du vol">
          <div className="grid grid-cols-2 gap-2">
            {PREPARATION_FIELDS.map((definition) => {
              const Icon = definition.icon;
              return (
                <button
                  key={definition.field}
                  type="button"
                  onClick={() => openSelector(definition)}
                  className="group flex h-[78px] w-full items-center gap-2.5 rounded-2xl border px-3 text-left transition-[transform,border-color,background-color,box-shadow] duration-200 ease-out hover:border-[var(--bc-border-strong)] active:scale-[0.98]"
                  style={{
                    background: "var(--bc-surface)",
                    borderColor: "var(--bc-border)",
                    boxShadow: "0 8px 22px rgb(0 0 0 / 14%)",
                  }}
                  aria-label={`Modifier ${definition.label.toLowerCase()}`}
                >
                  <span
                    aria-hidden="true"
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
                    style={{
                      background: "var(--bc-background-elevated)",
                      color: "var(--bc-accent)",
                    }}
                  >
                    <Icon size={18} strokeWidth={1.9} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className="block truncate text-[10px] font-bold uppercase tracking-[0.07em]"
                      style={{ color: "var(--bc-text-secondary)" }}
                    >
                      {definition.label}
                    </span>
                    <span className="mt-0.5 block truncate text-[15px] font-extrabold leading-tight">
                      {getDisplayValue(
                        definition.field,
                        preparation[definition.field],
                      )}
                    </span>
                  </span>
                  <ChevronRight
                    aria-hidden="true"
                    size={16}
                    strokeWidth={1.8}
                    style={{ color: "var(--bc-text-muted)" }}
                  />
                </button>
              );
            })}
          </div>
        </section>

        <div
          className="my-2 flex min-h-4 items-center justify-center gap-1.5 text-[11px] font-semibold transition-opacity duration-200"
          aria-live="polite"
          style={{
            color:
              calculationState === "error"
                ? "var(--bc-danger)"
                : "var(--bc-text-muted)",
          }}
        >
          {calculationState === "calculating" && (
            <>
              <span
                className="h-1.5 w-1.5 animate-pulse rounded-full"
                style={{ background: "var(--bc-accent)" }}
              />
              Mise à jour…
            </>
          )}
          {calculationState === "error" && "Enregistrement indisponible"}
        </div>

        {calculationState === "ready" && (
          <section aria-labelledby="flight-validation-title">
            <h2
              id="flight-validation-title"
              className="mb-1.5 text-[16px] font-black tracking-tight"
            >
              Validation du vol
            </h2>

            <div className="grid grid-cols-2 gap-1.5">
              {VALIDATION_CARDS.map((card) => {
                const Icon = card.icon;
                return (
                  <button
                    key={card.label}
                    type="button"
                    onClick={() => router.push(card.href)}
                    className="flex h-[68px] items-center gap-2 rounded-2xl border px-2.5 text-left transition-[transform,border-color,background-color,box-shadow] duration-200 ease-out hover:border-[var(--bc-border-strong)] active:scale-[0.98]"
                    style={{
                      background: "var(--bc-surface)",
                      borderColor: isComplete
                        ? "rgb(69 196 134 / 48%)"
                        : "var(--bc-border)",
                      boxShadow: "0 8px 22px rgb(0 0 0 / 14%)",
                    }}
                  >
                    <span
                      aria-hidden="true"
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl"
                      style={{
                        background: "var(--bc-background-elevated)",
                        color: "var(--bc-success)",
                      }}
                    >
                      <Icon size={17} strokeWidth={1.9} />
                    </span>
                    <span className="min-w-0 flex-1 text-[12px] font-extrabold leading-tight">
                      {card.label}
                    </span>
                    <span
                      aria-hidden="true"
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
                      style={{
                        background: isComplete
                          ? "rgb(69 196 134 / 18%)"
                          : "var(--bc-background-elevated)",
                        color: isComplete
                          ? "var(--bc-success)"
                          : "var(--bc-text-muted)",
                      }}
                    >
                      {isComplete ? (
                        <Check size={12} strokeWidth={2.5} />
                      ) : (
                        <ChevronRight size={12} strokeWidth={2} />
                      )}
                    </span>
                  </button>
                );
              })}
            </div>

            {isComplete ? (
              <div
                className="mt-2.5 flex items-center gap-3 rounded-2xl border px-4 py-3.5"
                style={{
                  background:
                    "linear-gradient(135deg, rgb(69 196 134 / 20%), rgb(69 196 134 / 8%))",
                  borderColor: "rgb(69 196 134 / 68%)",
                  boxShadow: "0 10px 28px rgb(69 196 134 / 14%)",
                }}
              >
                <span
                  aria-hidden="true"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
                  style={{
                    background: "rgb(69 196 134 / 18%)",
                    color: "var(--bc-success)",
                  }}
                >
                  <Balloon size={21} strokeWidth={2} />
                </span>
                <div>
                  <p
                    className="text-xl font-black tracking-tight"
                    style={{ color: "var(--bc-success)" }}
                  >
                    Préparation terminée
                  </p>
                  <p
                    className="mt-0.5 text-[10px] font-semibold"
                    style={{ color: "var(--bc-text-secondary)" }}
                  >
                    Consultez chaque rubrique avant votre décision de vol.
                  </p>
                </div>
              </div>
            ) : (
              <p
                className="mt-2.5 text-center text-xs font-semibold"
                style={{ color: "var(--bc-warning)" }}
              >
                Renseigner la date pour finaliser la préparation.
              </p>
            )}
          </section>
        )}

        <p
          className="mx-auto mt-2.5 max-w-sm text-center text-[10px] leading-4"
          style={{ color: "var(--bc-text-muted)" }}
        >
          Balloon Companion assiste la préparation. Le pilote reste seul
          responsable de la décision de vol.
        </p>
      </div>

      <NavigationBar activeItem="Préparer" />

      {activeSelector && (
        <div
          className="fixed inset-0 z-[80] flex items-end justify-center bg-black/60 px-3 backdrop-blur-sm sm:items-center"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setActiveSelector(null);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="preparation-selector-title"
            className="w-full max-w-md rounded-t-[28px] border p-5 pb-[max(24px,env(safe-area-inset-bottom))] sm:rounded-[28px]"
            style={{
              background: "var(--bc-background-elevated)",
              borderColor: "var(--bc-border)",
              boxShadow: "0 -20px 60px rgb(0 0 0 / 35%)",
            }}
          >
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                {ActiveSelectorIcon && (
                  <ActiveSelectorIcon
                    aria-hidden="true"
                    size={24}
                    strokeWidth={1.9}
                    style={{ color: "var(--bc-accent)" }}
                  />
                )}
                <h2
                  id="preparation-selector-title"
                  className="mt-2 text-2xl font-black"
                >
                  {activeSelector.label}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setActiveSelector(null)}
                className="flex h-12 w-12 items-center justify-center rounded-full border text-xl"
                style={{
                  background: "var(--bc-surface)",
                  borderColor: "var(--bc-border)",
                  color: "var(--bc-text-secondary)",
                }}
                aria-label="Fermer le sélecteur"
              >
                <X aria-hidden="true" size={20} />
              </button>
            </div>

            {activeSelector.field === "terrain" && (
              <input
                autoFocus
                type="text"
                value={draftValue}
                onChange={(event) => setDraftValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") confirmSelection();
                }}
                className="h-16 w-full rounded-2xl border px-5 text-xl font-bold outline-none"
                style={{
                  background: "var(--bc-surface)",
                  borderColor: "var(--bc-border-strong)",
                  color: "var(--bc-text-primary)",
                }}
                aria-label="Nom du terrain"
              />
            )}

            {activeSelector.field === "date" && (
              <input
                autoFocus
                type="date"
                value={draftValue}
                onChange={(event) => setDraftValue(event.target.value)}
                className="h-16 w-full rounded-2xl border px-5 text-xl font-bold outline-none"
                style={{
                  colorScheme: "dark",
                  background: "var(--bc-surface)",
                  borderColor: "var(--bc-border-strong)",
                  color: "var(--bc-text-primary)",
                }}
                aria-label="Date du vol"
              />
            )}

            {activeSelector.field === "heure" && (
              <input
                autoFocus
                type="time"
                value={draftValue}
                onChange={(event) => setDraftValue(event.target.value)}
                className="h-16 w-full rounded-2xl border px-5 text-xl font-bold outline-none"
                style={{
                  colorScheme: "dark",
                  background: "var(--bc-surface)",
                  borderColor: "var(--bc-border-strong)",
                  color: "var(--bc-text-primary)",
                }}
                aria-label="Heure de décollage"
              />
            )}

            {options && (
              <div className="grid gap-2">
                {options.map((option) => {
                  const selected = draftValue === option;
                  return (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setDraftValue(option)}
                      className="flex min-h-14 items-center justify-between rounded-2xl border px-5 text-left text-lg font-bold"
                      style={{
                        background: selected
                          ? "rgb(245 158 66 / 12%)"
                          : "var(--bc-surface)",
                        borderColor: selected
                          ? "var(--bc-accent)"
                          : "var(--bc-border)",
                        color: "var(--bc-text-primary)",
                      }}
                    >
                      {option}
                      {selected && (
                        <Check
                          aria-hidden="true"
                          size={18}
                          strokeWidth={2.5}
                          style={{ color: "var(--bc-accent)" }}
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            <button
              type="button"
              onClick={confirmSelection}
              disabled={!draftValue.trim()}
              className="mt-5 min-h-14 w-full rounded-2xl px-5 text-lg font-black disabled:cursor-not-allowed disabled:opacity-40"
              style={{
                background: "var(--bc-accent)",
                color: "var(--bc-accent-foreground)",
                boxShadow: "var(--bc-shadow-action)",
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

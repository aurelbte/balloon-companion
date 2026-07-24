"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
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
  icon: string;
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
  { field: "terrain", icon: "📍", label: "Terrain" },
  { field: "date", icon: "📅", label: "Date" },
  { field: "heure", icon: "🕐", label: "Heure de décollage" },
  { field: "duree", icon: "⏱", label: "Durée prévue" },
  { field: "meteo", icon: "🌤", label: "Modèle météo" },
  { field: "ballon", icon: "🎈", label: "Ballon" },
];

const SELECTOR_OPTIONS: Partial<Record<PreparationField, string[]>> = {
  duree: ["30 min", "45 min", "60 min", "90 min"],
  meteo: ["AROME", "ICON", "GFS"],
  ballon: ["Cameron Z-105"],
};

const VALIDATION_CARDS = [
  { icon: "🌤", label: "Conditions météo", href: "/briefing" },
  { icon: "🧭", label: "Trajectoire", href: "/map" },
  { icon: "⚖️", label: "Charge", href: "/briefing" },
  { icon: "🛩️", label: "Espaces aériens", href: "/flight" },
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

  return (
    <main className="min-h-screen px-4 pb-32 pt-5 sm:px-6 sm:pt-7">
      <div className="mx-auto w-full max-w-lg">
        <header className="mb-6">
          <p
            className="mb-1.5 text-xs font-bold uppercase tracking-[0.2em]"
            style={{ color: "var(--bc-accent)" }}
          >
            Prépa
          </p>
          <h1 className="text-[2rem] font-black leading-tight tracking-tight">
            Préparer le vol
          </h1>
          <p
            className="mt-2 max-w-sm text-[15px] leading-6"
            style={{ color: "var(--bc-text-secondary)" }}
          >
            Les informations sont enregistrées automatiquement.
          </p>
        </header>

        <section aria-label="Paramètres du vol">
          <div className="grid gap-3 sm:grid-cols-2">
            {PREPARATION_FIELDS.map((definition) => (
              <button
                key={definition.field}
                type="button"
                onClick={() => openSelector(definition)}
                className="group flex min-h-[104px] w-full items-center gap-4 rounded-[20px] border px-5 py-4 text-left transition-colors active:scale-[0.99]"
                style={{
                  background: "var(--bc-surface)",
                  borderColor: "var(--bc-border)",
                  boxShadow: "var(--bc-shadow-card)",
                }}
                aria-label={`Modifier ${definition.label.toLowerCase()}`}
              >
                <span
                  aria-hidden="true"
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-[1.35rem]"
                  style={{ background: "var(--bc-background-elevated)" }}
                >
                  {definition.icon}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className="block text-[13px] font-bold uppercase tracking-[0.08em]"
                    style={{ color: "var(--bc-text-secondary)" }}
                  >
                    {definition.label}
                  </span>
                  <span className="mt-1 block truncate text-lg font-extrabold">
                    {getDisplayValue(
                      definition.field,
                      preparation[definition.field],
                    )}
                  </span>
                </span>
                <span
                  aria-hidden="true"
                  className="text-xl font-light"
                  style={{ color: "var(--bc-text-muted)" }}
                >
                  ›
                </span>
              </button>
            ))}
          </div>
        </section>

        <div
          className="my-5 flex min-h-6 items-center justify-center gap-2 text-sm font-semibold"
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
                className="h-2 w-2 animate-pulse rounded-full"
                style={{ background: "var(--bc-accent)" }}
              />
              Mise à jour…
            </>
          )}
          {calculationState === "error" && "Enregistrement indisponible"}
        </div>

        {calculationState === "ready" && (
          <section aria-labelledby="flight-validation-title" className="mt-1">
            <h2
              id="flight-validation-title"
              className="mb-3 text-lg font-black tracking-tight"
            >
              Validation du vol
            </h2>

            <div className="grid grid-cols-2 gap-3">
              {VALIDATION_CARDS.map((card) => (
                <button
                  key={card.label}
                  type="button"
                  onClick={() => router.push(card.href)}
                  className="flex min-h-[112px] flex-col items-start justify-between rounded-[18px] border p-4 text-left transition-colors active:scale-[0.99]"
                  style={{
                    background: "var(--bc-surface)",
                    borderColor: isComplete
                      ? "rgb(69 196 134 / 55%)"
                      : "var(--bc-border)",
                  }}
                >
                  <span className="flex w-full items-start justify-between">
                    <span aria-hidden="true" className="text-xl">
                      {card.icon}
                    </span>
                    <span
                      aria-hidden="true"
                      className="flex h-6 w-6 items-center justify-center rounded-full text-sm font-black"
                      style={{
                        background: isComplete
                          ? "rgb(69 196 134 / 18%)"
                          : "var(--bc-background-elevated)",
                        color: isComplete
                          ? "var(--bc-success)"
                          : "var(--bc-text-muted)",
                      }}
                    >
                      {isComplete ? "✓" : "›"}
                    </span>
                  </span>
                  <span className="mt-3 text-[15px] font-extrabold leading-tight">
                    {card.label}
                  </span>
                </button>
              ))}
            </div>

            {isComplete ? (
              <div
                className="mt-5 rounded-[22px] border px-5 py-6 text-center"
                style={{
                  background: "rgb(69 196 134 / 13%)",
                  borderColor: "rgb(69 196 134 / 55%)",
                  boxShadow: "0 16px 40px rgb(69 196 134 / 10%)",
                }}
              >
                <p
                  className="text-2xl font-black tracking-tight"
                  style={{ color: "var(--bc-success)" }}
                >
                  🎈 Prêt au décollage
                </p>
                <p
                  className="mt-2 text-xs font-semibold"
                  style={{ color: "var(--bc-text-secondary)" }}
                >
                  Vérifier chaque rubrique avant la décision de vol.
                </p>
              </div>
            ) : (
              <p
                className="mt-4 text-center text-sm font-semibold"
                style={{ color: "var(--bc-warning)" }}
              >
                Renseigner la date pour finaliser la préparation.
              </p>
            )}
          </section>
        )}

        <p
          className="mx-auto mt-6 max-w-sm text-center text-xs leading-5"
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
                <span aria-hidden="true" className="text-2xl">
                  {activeSelector.icon}
                </span>
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
                ×
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
                        <span style={{ color: "var(--bc-accent)" }}>✓</span>
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

"use client";

import { useState } from "react";
import Link from "next/link";
import { getCurrentFlight, type Flight } from "../lib/flightStorage";
import NavigationBar from "../components/NavigationBar";
import Button from "../components/Button";

type WindLevel = {
  altitude: string;
  speed: number;
  direction: number;
};

const windLevels: WindLevel[] = [
  { altitude: "Sol", speed: 6, direction: 240 },
  { altitude: "100 m", speed: 10, direction: 245 },
  { altitude: "300 m", speed: 14, direction: 255 },
  { altitude: "600 m", speed: 20, direction: 265 },
];

const conditions = [
  { label: "Température", value: "12 °C" },
  { label: "Point de rosée", value: "8 °C" },
  { label: "Lever du soleil", value: "05:58" },
  { label: "Visibilité", value: "10 km ou plus" },
  { label: "Espaces aériens", value: "À vérifier" },
  { label: "NOTAM", value: "Non chargés" },
];

export default function BriefingPage() {
  const flight = useState<Flight | null>(() => getCurrentFlight())[0];

  // Afficher un message si aucun vol n'est enregistré
  if (!flight) {
    return (
      <main className="min-h-screen px-4 pb-28 pt-6 sm:px-6">
        <div className="mx-auto w-full max-w-md">
          <header className="mb-7">
            <p
              className="mb-2 text-sm font-semibold uppercase tracking-[0.2em]"
              style={{ color: "var(--bc-accent)" }}
            >
              Briefing
            </p>

            <h1 className="text-3xl font-bold tracking-tight">
              Aucune préparation
            </h1>

            <p
              className="mt-2 text-base"
              style={{ color: "var(--bc-text-secondary)" }}
            >
              Veuillez commencer une préparation de vol pour accéder au briefing.
            </p>
          </header>

          <div className="mb-7">
            <Button href="/prepare">Préparer un vol</Button>
          </div>
        </div>

        <NavigationBar activeItem="Préparer" />
      </main>
    );
  }

  // Formater la date si elle existe
  const formatDate = (dateStr: string): string => {
    if (!dateStr) return "À renseigner";
    try {
      const date = new Date(dateStr);
      const day = String(date.getDate()).padStart(2, "0");
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const year = date.getFullYear();
      return `${day}/${month}/${year}`;
    } catch {
      return dateStr;
    }
  };

  return (
    <main className="min-h-screen px-4 pb-28 pt-6 sm:px-6">
      <div className="mx-auto w-full max-w-md">
        {/* En-tête - Style dossier officiel */}
        <header className="mb-8">
          <div
            className="mb-6 rounded-lg border p-6"
            style={{
              background: "var(--bc-surface)",
              borderColor: "var(--bc-border)",
            }}
          >
            <p
              className="text-xs font-bold uppercase tracking-[0.3em] letter-spacing"
              style={{ color: "var(--bc-accent)" }}
            >
              ✈ DOSSIER DE VOL
            </p>

            <h1 className="mt-4 text-4xl font-black tracking-tight">
              Briefing
            </h1>

            <div className="mt-6 space-y-2 border-t border-gray-700 pt-4">
              <div className="flex justify-between">
                <span
                  className="text-xs font-semibold uppercase tracking-wider"
                  style={{ color: "var(--bc-text-muted)" }}
                >
                  Terrain
                </span>
                <span
                  className="font-semibold"
                  style={{ color: "var(--bc-text-primary)" }}
                >
                  {flight?.terrain || "À renseigner"}
                </span>
              </div>
              <div className="flex justify-between">
                <span
                  className="text-xs font-semibold uppercase tracking-wider"
                  style={{ color: "var(--bc-text-muted)" }}
                >
                  Date & Heure
                </span>
                <span
                  className="font-semibold"
                  style={{ color: "var(--bc-text-primary)" }}
                >
                  {flight?.date || flight?.heure
                    ? `${formatDate(flight.date || "")} · ${flight.heure || ""}`
                    : "À renseigner"}
                </span>
              </div>
              <div className="flex justify-between">
                <span
                  className="text-xs font-semibold uppercase tracking-wider"
                  style={{ color: "var(--bc-text-muted)" }}
                >
                  Ballon
                </span>
                <span
                  className="font-semibold"
                  style={{ color: "var(--bc-text-primary)" }}
                >
                  {flight?.ballon || "À renseigner"}
                </span>
              </div>
              <div className="flex justify-between">
                <span
                  className="text-xs font-semibold uppercase tracking-wider"
                  style={{ color: "var(--bc-text-muted)" }}
                >
                  Durée
                </span>
                <span
                  className="font-semibold"
                  style={{ color: "var(--bc-text-primary)" }}
                >
                  {flight?.duree || "À renseigner"}
                </span>
              </div>
              <div className="flex justify-between">
                <span
                  className="text-xs font-semibold uppercase tracking-wider"
                  style={{ color: "var(--bc-text-muted)" }}
                >
                  Modèle météo
                </span>
                <span
                  className="font-semibold"
                  style={{ color: "var(--bc-text-primary)" }}
                >
                  {flight?.meteo || "À renseigner"}
                </span>
              </div>
            </div>
          </div>

          <Link
            href="/prepare"
            className="inline-block text-xs font-semibold"
            style={{ color: "var(--bc-accent)" }}
          >
            ↑ Modifier la préparation
          </Link>
        </header>

        {/* Statut & Confiance */}
        <section className="mb-8 grid grid-cols-2 gap-4">
          <div
            className="rounded-lg border p-4"
            style={{
              background: "var(--bc-surface)",
              borderColor: "var(--bc-border)",
            }}
          >
            <p
              className="text-xs font-bold uppercase tracking-[0.14em]"
              style={{ color: "var(--bc-text-muted)" }}
            >
              Statut
            </p>
            <p
              className="mt-3 text-2xl font-black"
              style={{ color: "var(--bc-warning)" }}
            >
              ⚠
            </p>
            <p
              className="mt-2 text-xs font-semibold"
              style={{ color: "var(--bc-warning)" }}
            >
              À vérifier
            </p>
          </div>

          <div
            className="rounded-lg border p-4"
            style={{
              background: "var(--bc-surface)",
              borderColor: "var(--bc-border)",
            }}
          >
            <p
              className="text-xs font-bold uppercase tracking-[0.14em]"
              style={{ color: "var(--bc-text-muted)" }}
            >
              Confiance
            </p>
            <p
              className="mt-3 text-3xl font-black"
              style={{ color: "var(--bc-success)" }}
            >
              78%
            </p>
          </div>
        </section>

        {/* Avertissement simulé */}
        <section
          className="mb-8 rounded-lg border-2 p-4"
          style={{
            background: "rgb(239 68 68 / 12%)",
            borderColor: "var(--bc-danger)",
          }}
        >
          <p
            className="text-center text-xs font-bold uppercase tracking-wider"
            style={{ color: "var(--bc-danger)" }}
          >
            🔴 Données simulées
          </p>
          <p
            className="mt-3 text-center text-sm font-semibold"
            style={{ color: "var(--bc-danger)" }}
          >
            Ces informations ne sont pas opérationnelles et ne doivent pas servir
            pour une décision de vol.
          </p>
        </section>

        {/* Vent par altitude - Cartes prominentes */}
        <section className="mb-8">
          <h2
            className="mb-5 text-sm font-black uppercase tracking-[0.2em]"
            style={{ color: "var(--bc-accent)" }}
          >
            ⬇ Vent par altitude
          </h2>

          <div className="space-y-4">
            {windLevels.map((level) => (
              <div
                key={level.altitude}
                className="overflow-hidden rounded-lg border"
                style={{
                  background: "var(--bc-surface)",
                  borderColor: "var(--bc-border)",
                }}
              >
                <div
                  className="flex items-center justify-between px-5 py-3"
                  style={{
                    background: "var(--bc-background-elevated)",
                    borderBottom: "1px solid var(--bc-border)",
                  }}
                >
                  <h3
                    className="text-lg font-black"
                    style={{ color: "var(--bc-text-primary)" }}
                  >
                    {level.altitude}
                  </h3>

                  <span
                    className="rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-tight"
                    style={{
                      background: "var(--bc-warning)",
                      color: "var(--bc-accent-foreground)",
                    }}
                  >
                    SIMUL.
                  </span>
                </div>

                <div className="p-5">
                  <div className="flex items-baseline gap-3">
                    <span
                      className="text-6xl font-black leading-none"
                      style={{ color: "var(--bc-accent)" }}
                    >
                      {level.speed}
                    </span>
                    <span
                      className="text-xl font-bold"
                      style={{ color: "var(--bc-text-secondary)" }}
                    >
                      km/h
                    </span>
                  </div>

                  <div className="mt-5 flex items-center justify-between">
                    <span
                      className="text-xs font-semibold uppercase tracking-wider"
                      style={{ color: "var(--bc-text-muted)" }}
                    >
                      Direction
                    </span>
                    <span
                      className="text-2xl font-bold"
                      style={{ color: "var(--bc-text-primary)" }}
                    >
                      {level.direction}°
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Conditions complémentaires - Tableau */}
        <section className="mb-8">
          <h2
            className="mb-4 text-sm font-black uppercase tracking-[0.2em]"
            style={{ color: "var(--bc-accent)" }}
          >
            📋 Conditions complémentaires
          </h2>

          <div
            className="overflow-hidden rounded-lg border"
            style={{
              background: "var(--bc-surface)",
              borderColor: "var(--bc-border)",
            }}
          >
            <div
              className="grid grid-cols-2 gap-px"
              style={{ background: "var(--bc-border)" }}
            >
              {conditions.map((condition) => (
                <div
                  key={condition.label}
                  className="px-4 py-5"
                  style={{ background: "var(--bc-surface)" }}
                >
                  <p
                    className="text-xs font-semibold uppercase tracking-wider"
                    style={{ color: "var(--bc-text-muted)" }}
                  >
                    {condition.label}
                  </p>
                  <p
                    className="mt-2 text-lg font-bold"
                    style={{ color: "var(--bc-text-primary)" }}
                  >
                    {condition.value}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Actions */}
        <div className="mb-7 flex flex-col gap-3">
          {/* Bouton secondaire */}
          <Link href="/prepare" className="w-full">
            <button
              className="w-full rounded-lg border px-6 py-4 text-center font-bold uppercase tracking-wider transition-colors"
              style={{
                background: "transparent",
                borderColor: "var(--bc-border)",
                color: "var(--bc-text-primary)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "var(--bc-surface)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
              }}
            >
              ← Retour à la préparation
            </button>
          </Link>

          {/* Bouton principal actif */}
          <Link href="/map" className="w-full">
            <button
              className="w-full rounded-lg border px-6 py-4 text-center font-bold uppercase tracking-wider transition-colors"
              style={{
                background: "var(--bc-accent)",
                borderColor: "var(--bc-accent)",
                color: "var(--bc-accent-foreground)",
                boxShadow: "var(--bc-shadow-action)",
              }}
            >
              Voir la carte →
            </button>
          </Link>
        </div>
      </div>

      <NavigationBar activeItem="Préparer" />
    </main>
  );
}

"use client";

import { useState } from "react";
import Link from "next/link";
import { getCurrentFlight, type Flight } from "../lib/flightStorage";
import PreparationMap from "../components/PreparationMap";
import NavigationBar from "../components/NavigationBar";
import Button from "../components/Button";

export default function MapPage() {
  const flight = useState<Flight | null>(() => getCurrentFlight())[0];

  // Formater la date
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
              Carte de préparation
            </p>

            <h1 className="text-3xl font-bold tracking-tight">
              Aucun vol en préparation
            </h1>

            <p
              className="mt-2 text-base"
              style={{ color: "var(--bc-text-secondary)" }}
            >
              Commencez une préparation pour voir la carte.
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

  return (
    <main className="min-h-screen px-4 pb-28 pt-6 sm:px-6">
      <div className="mx-auto w-full max-w-md">
        {/* En-tête */}
        <header className="mb-7">
          <p
            className="mb-2 text-sm font-semibold uppercase tracking-[0.2em]"
            style={{ color: "var(--bc-accent)" }}
          >
            Carte de préparation
          </p>

          <h1 className="text-3xl font-bold tracking-tight">
            Trajectoire prévisionnelle
          </h1>

          <p
            className="mt-2 text-base"
            style={{ color: "var(--bc-text-secondary)" }}
          >
            Première visualisation du secteur de départ.
          </p>
        </header>

        {/* Infos du vol */}
        <section
          className="mb-7 overflow-hidden rounded-lg border p-5"
          style={{
            background: "var(--bc-surface)",
            borderColor: "var(--bc-border)",
          }}
        >
          <div className="space-y-3">
            <div className="flex items-center justify-between">
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

            <div className="flex items-center justify-between">
              <span
                className="text-xs font-semibold uppercase tracking-wider"
                style={{ color: "var(--bc-text-muted)" }}
              >
                Date
              </span>
              <span
                className="font-semibold"
                style={{ color: "var(--bc-text-primary)" }}
              >
                {formatDate(flight?.date || "")}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span
                className="text-xs font-semibold uppercase tracking-wider"
                style={{ color: "var(--bc-text-muted)" }}
              >
                Heure
              </span>
              <span
                className="font-semibold"
                style={{ color: "var(--bc-text-primary)" }}
              >
                {flight?.heure || "À renseigner"}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span
                className="text-xs font-semibold uppercase tracking-wider"
                style={{ color: "var(--bc-text-muted)" }}
              >
                Durée estimée
              </span>
              <span
                className="font-semibold"
                style={{ color: "var(--bc-text-primary)" }}
              >
                {flight?.duree || "À renseigner"}
              </span>
            </div>
          </div>
        </section>

        {/* Carte */}
        <section className="mb-7">
          <PreparationMap terrain={flight?.terrain} />
        </section>

        {/* Avertissement */}
        <section
          className="mb-7 rounded-lg border-2 p-4"
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
            La position et les données affichées sont simulées et ne doivent
            pas être utilisées pour la navigation.
          </p>
        </section>

        {/* Actions */}
        <div className="mb-7">
          <Link href="/briefing" className="w-full">
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
              ← Retour au briefing
            </button>
          </Link>
        </div>
      </div>

      <NavigationBar activeItem="Préparer" />
    </main>
  );
}

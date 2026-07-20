"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveCurrentFlight } from "../lib/flightStorage";
import Button from "../components/Button";
import NavigationBar from "../components/NavigationBar";

type FormData = {
  terrain: string;
  date: string;
  heure: string;
  duree: string;
  ballon: string;
  meteo: string;
};

export default function PreparePage() {
  const router = useRouter();
  const [formData, setFormData] = useState<FormData>({
    terrain: "Bondues",
    date: "",
    heure: "06:15",
    duree: "45 min",
    ballon: "Cameron Z-105",
    meteo: "AROME",
  });

  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Sauvegarder le vol dans localStorage
    const saved = saveCurrentFlight(formData);
    if (saved) {
      // Naviguer vers le briefing
      router.push("/briefing");
    } else {
      console.error("Erreur lors de la sauvegarde du vol");
    }
  };

  return (
    <main className="min-h-screen px-4 pb-28 pt-6 sm:px-6">
      <div className="mx-auto w-full max-w-md">
        {/* En-tête */}
        <header className="mb-7">
          <p
            className="mb-2 text-sm font-semibold uppercase tracking-[0.2em]"
            style={{ color: "var(--bc-accent)" }}
          >
            Préparation
          </p>

          <h1 className="text-3xl font-bold tracking-tight">
            Préparer un vol
          </h1>

          <p
            className="mt-2 text-base"
            style={{ color: "var(--bc-text-secondary)" }}
          >
            Renseigne les informations de départ avant de lancer le briefing.
          </p>
        </header>

        {/* Formulaire */}
        <form onSubmit={handleSubmit} className="mb-7 space-y-5">
          {/* Terrain de décollage */}
          <div>
            <label
              className="block text-sm font-semibold uppercase tracking-tight"
              style={{ color: "var(--bc-text-primary)" }}
            >
              Terrain de décollage
            </label>
            <input
              type="text"
              name="terrain"
              value={formData.terrain}
              onChange={handleInputChange}
              placeholder="Bondues"
              className="mt-2 w-full rounded-lg border px-4 py-3 text-base transition-colors focus:outline-none focus:ring-2"
              style={{
                background: "var(--bc-surface)",
                borderColor: "var(--bc-border)",
                color: "var(--bc-text-primary)",
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = "var(--bc-accent)";
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = "var(--bc-border)";
              }}
            />
          </div>

          {/* Date du vol */}
          <div>
            <label
              className="block text-sm font-semibold uppercase tracking-tight"
              style={{ color: "var(--bc-text-primary)" }}
            >
              Date du vol
            </label>
            <input
              type="date"
              name="date"
              value={formData.date}
              onChange={handleInputChange}
              className="mt-2 w-full rounded-lg border px-4 py-3 text-base transition-colors focus:outline-none"
              style={{
                background: "var(--bc-surface)",
                borderColor: "var(--bc-border)",
                color: "var(--bc-text-primary)",
              }}
            />
          </div>

          {/* Heure prévue */}
          <div>
            <label
              className="block text-sm font-semibold uppercase tracking-tight"
              style={{ color: "var(--bc-text-primary)" }}
            >
              Heure prévue
            </label>
            <input
              type="time"
              name="heure"
              value={formData.heure}
              onChange={handleInputChange}
              className="mt-2 w-full rounded-lg border px-4 py-3 text-base transition-colors focus:outline-none"
              style={{
                background: "var(--bc-surface)",
                borderColor: "var(--bc-border)",
                color: "var(--bc-text-primary)",
              }}
            />
          </div>

          {/* Durée estimée */}
          <div>
            <label
              className="block text-sm font-semibold uppercase tracking-tight"
              style={{ color: "var(--bc-text-primary)" }}
            >
              Durée estimée
            </label>
            <select
              name="duree"
              value={formData.duree}
              onChange={handleInputChange}
              className="mt-2 w-full rounded-lg border px-4 py-3 text-base transition-colors focus:outline-none"
              style={{
                background: "var(--bc-surface)",
                borderColor: "var(--bc-border)",
                color: "var(--bc-text-primary)",
              }}
            >
              <option value="30 min">30 min</option>
              <option value="45 min">45 min</option>
              <option value="60 min">60 min</option>
              <option value="90 min">90 min</option>
            </select>
          </div>

          {/* Ballon */}
          <div>
            <label
              className="block text-sm font-semibold uppercase tracking-tight"
              style={{ color: "var(--bc-text-primary)" }}
            >
              Ballon
            </label>
            <select
              name="ballon"
              value={formData.ballon}
              onChange={handleInputChange}
              className="mt-2 w-full rounded-lg border px-4 py-3 text-base transition-colors focus:outline-none"
              style={{
                background: "var(--bc-surface)",
                borderColor: "var(--bc-border)",
                color: "var(--bc-text-primary)",
              }}
            >
              <option value="Cameron Z-105">Cameron Z-105</option>
            </select>
          </div>

          {/* Modèle météo */}
          <div>
            <label
              className="block text-sm font-semibold uppercase tracking-tight"
              style={{ color: "var(--bc-text-primary)" }}
            >
              Modèle météo
            </label>
            <select
              name="meteo"
              value={formData.meteo}
              onChange={handleInputChange}
              className="mt-2 w-full rounded-lg border px-4 py-3 text-base transition-colors focus:outline-none"
              style={{
                background: "var(--bc-surface)",
                borderColor: "var(--bc-border)",
                color: "var(--bc-text-primary)",
              }}
            >
              <option value="AROME">AROME</option>
              <option value="ICON">ICON</option>
              <option value="GFS">GFS</option>
            </select>
          </div>

          {/* Bouton principal */}
          <div className="pt-2">
            <Button>Commencer le briefing</Button>
          </div>

          {/* Message de sécurité */}
          <p
            className="text-center text-xs"
            style={{ color: "var(--bc-text-muted)" }}
          >
            Balloon Companion est une aide à la préparation. Le pilote reste
            seul responsable de la décision de vol.
          </p>
        </form>
      </div>

      <NavigationBar activeItem="Préparer" />
    </main>
  );
}

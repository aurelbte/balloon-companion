"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { RecordedFlight } from "../lib/recordedFlight";
import { getRecordedFlightPresentation } from "../lib/recordedFlightPresentation";
import { IndexedDbRecordedFlightStorage } from "../lib/recordedFlightStorage";
import NavigationBar from "../components/NavigationBar";
import { getFlightReplayPath } from "../lib/recordedFlightPresentation";

export default function FlightsPage() {
  const [flights, setFlights] = useState<RecordedFlight[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void new IndexedDbRecordedFlightStorage()
      .listFlights()
      .then((storedFlights) => {
        if (!cancelled) setFlights(storedFlights);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="min-h-screen px-4 pb-28 pt-6 sm:px-6">
      <div className="mx-auto w-full max-w-md">
        <Link
          href="/"
          style={{ color: "var(--bc-text-secondary)", fontWeight: 800 }}
        >
          ← Accueil
        </Link>
        <header style={{ margin: "24px 0" }}>
          <p
            style={{
              color: "var(--bc-accent)",
              fontSize: "12px",
              fontWeight: 900,
              letterSpacing: ".12em",
            }}
          >
            VOLS CONSERVÉS
          </p>
          <h1 style={{ marginTop: "7px", fontSize: "30px", fontWeight: 950 }}>
            Journal des vols
          </h1>
        </header>
        {loading ? (
          <p>Chargement…</p>
        ) : flights.length === 0 ? (
          <p style={{ color: "var(--bc-text-secondary)" }}>
            Aucun vol enregistré sur cet appareil.
          </p>
        ) : (
          <div style={{ display: "grid", gap: "12px" }}>
            {flights.map((flight) => {
              const presentation = getRecordedFlightPresentation(flight);
              return (
                <Link
                  key={flight.id}
                  href={getFlightReplayPath(flight.id)}
                  style={{
                    padding: "17px",
                    border: "1px solid var(--bc-border)",
                    borderRadius: "16px",
                    background: "var(--bc-surface)",
                    color: "var(--bc-text-primary)",
                    textDecoration: "none",
                  }}
                >
                  <strong style={{ fontSize: "18px" }}>
                    {presentation.date} · {presentation.startTime}
                  </strong>
                  <span
                    style={{
                      display: "block",
                      marginTop: "7px",
                      color: "var(--bc-text-secondary)",
                    }}
                  >
                    {presentation.duration} · {presentation.distance}
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </div>
      <NavigationBar activeItem="Journal" />
    </main>
  );
}

"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import FlightReplayMap from "../../components/flight/FlightReplayMap";
import RecordedFlightSummaryCard from "../../components/flight/RecordedFlightSummaryCard";
import type { RecordedFlight } from "../../lib/recordedFlight";
import { IndexedDbRecordedFlightStorage } from "../../lib/recordedFlightStorage";
import NavigationBar from "../../components/NavigationBar";

export default function RecordedFlightPage() {
  const params = useParams<{ id: string }>();
  const [flight, setFlight] = useState<RecordedFlight | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const id = params.id;
    if (process.env.NODE_ENV === "development") {
      console.debug(`[flight-replay] loading ${id}`);
    }
    void new IndexedDbRecordedFlightStorage()
      .getFlight(id)
      .then((storedFlight) => {
        if (process.env.NODE_ENV === "development") {
          console.debug(`[flight-replay] found ${Boolean(storedFlight)}`);
        }
        if (!cancelled) {
          setFlight(storedFlight);
          setLoadError(null);
        }
      })
      .catch((error: unknown) => {
        console.error("Impossible de lire le vol enregistré", error);
        if (!cancelled) {
          setFlight(null);
          setLoadError("Impossible de lire les vols enregistrés sur cet appareil.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [params.id]);

  return (
    <main className="min-h-screen px-4 pb-28 pt-6 sm:px-6">
      <div className="mx-auto w-full max-w-xl">
        <Link
          href="/flights"
          style={{ color: "var(--bc-text-secondary)", fontWeight: 800 }}
        >
          ← Mes vols
        </Link>
        {loading ? (
          <p style={{ marginTop: "32px" }}>Chargement du vol…</p>
        ) : loadError ? (
          <section style={{ marginTop: "32px" }}>
            <h1 style={{ fontSize: "28px", fontWeight: 900 }}>
              Lecture indisponible
            </h1>
            <p
              role="alert"
              style={{
                marginTop: "10px",
                color: "var(--bc-text-secondary)",
              }}
            >
              {loadError}
            </p>
          </section>
        ) : !flight ? (
          <section style={{ marginTop: "32px" }}>
            <h1 style={{ fontSize: "28px", fontWeight: 900 }}>
              Vol introuvable
            </h1>
            <p
              style={{
                marginTop: "10px",
                color: "var(--bc-text-secondary)",
              }}
            >
              Ce vol n’est pas présent sur cet appareil.
            </p>
          </section>
        ) : (
          <>
            <header style={{ margin: "24px 0 18px" }}>
              <p
                style={{
                  color: "var(--bc-accent)",
                  fontSize: "12px",
                  fontWeight: 900,
                  letterSpacing: ".12em",
                }}
              >
                TRACE ENREGISTRÉE
              </p>
              <h1
                style={{ marginTop: "7px", fontSize: "30px", fontWeight: 950 }}
              >
                Relecture du vol
              </h1>
            </header>
            <FlightReplayMap flight={flight} />
            <section style={{ marginTop: "18px" }}>
              <RecordedFlightSummaryCard flight={flight} />
            </section>
            <Link
              href="/flight"
              style={{
                display: "grid",
                minHeight: "54px",
                placeItems: "center",
                marginTop: "18px",
                borderRadius: "14px",
                background: "var(--bc-accent)",
                color: "var(--bc-accent-foreground)",
                fontWeight: 900,
                textDecoration: "none",
              }}
            >
              RETOUR AU MODE VOL
            </Link>
          </>
        )}
      </div>
      <NavigationBar activeItem="Journal" />
    </main>
  );
}

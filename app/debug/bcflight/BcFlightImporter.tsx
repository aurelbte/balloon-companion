"use client";

import { useState } from "react";
import { BcFlightImportError, parseBcFlight, type ImportedBcFlight } from "../../lib/bcFlightImport.ts";

function value(value: number | null | undefined, unit = ""): string {
  return value === null || value === undefined ? "—" : `${Number(value.toFixed(2))}${unit}`;
}

export default function BcFlightImporter() {
  const [imported, setImported] = useState<ImportedBcFlight | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <main className="min-h-screen px-4 py-8 sm:px-6">
      <div className="mx-auto w-full max-w-3xl">
        <p style={{ color: "var(--bc-accent)", fontSize: "12px", fontWeight: 900, letterSpacing: ".12em" }}>DIAGNOSTIC DÉVELOPPEMENT</p>
        <h1 style={{ marginTop: "8px", fontSize: "30px", fontWeight: 950 }}>Relecture BCFLIGHT</h1>
        <label style={{ display: "grid", placeItems: "center", minHeight: "54px", marginTop: "24px", borderRadius: "14px", background: "var(--bc-accent)", color: "var(--bc-accent-foreground)", fontWeight: 900, cursor: "pointer" }}>
          Importer un fichier .bcflight
          <input
            type="file"
            accept=".bcflight,application/json"
            hidden
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (!file) return;
              setError(null);
              void file.text().then((text) => {
                setImported(parseBcFlight(text));
              }).catch((reason: unknown) => {
                setImported(null);
                setError(reason instanceof BcFlightImportError ? reason.message : "Impossible de lire ce fichier.");
              });
            }}
          />
        </label>
        {error && <p role="alert" style={{ marginTop: "14px", color: "#ef9a9a" }}>{error}</p>}
        {imported && (
          <section style={{ marginTop: "24px", display: "grid", gap: "18px" }}>
            <div>
              <h2 style={{ fontSize: "20px", fontWeight: 900 }}>Vol importé en mémoire</h2>
              <p>Date : {new Date(imported.flight.startedAt).toLocaleString("fr-FR")}</p>
              <p>Durée : {value(imported.container.statistics.durationSeconds, " s")}</p>
              <p>Ballon : {imported.flight.balloonRegistration ?? "—"}</p>
              <p>Points : {imported.diagnostic.pointCounts.total} · VALID {imported.diagnostic.pointCounts.valid} · SUSPECT {imported.diagnostic.pointCounts.suspect} · INVALID {imported.diagnostic.pointCounts.invalid}</p>
              <p>Gaps/background : {imported.diagnostic.gapOrBackgroundCount}</p>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: "12px" }}>
              <pre style={{ overflow: "auto", padding: "14px", borderRadius: "12px", background: "var(--bc-surface)" }}>Stats exportées{"\n"}{JSON.stringify(imported.container.statistics, null, 2)}</pre>
              <pre style={{ overflow: "auto", padding: "14px", borderRadius: "12px", background: "var(--bc-surface)" }}>Stats recalculées{"\n"}{JSON.stringify(imported.diagnostic.newStatistics, null, 2)}</pre>
            </div>
            <pre style={{ overflow: "auto", padding: "14px", borderRadius: "12px", background: "var(--bc-surface)" }}>Records vitesse/vario{"\n"}{JSON.stringify(imported.diagnostic.records, null, 2)}</pre>
          </section>
        )}
      </div>
    </main>
  );
}

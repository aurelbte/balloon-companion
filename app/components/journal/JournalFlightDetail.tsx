"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BarChart3, ChevronRight, FileDown, Gauge, NotebookPen } from "lucide-react";
import NavigationBar from "../NavigationBar";
import { useFlightCompletionState } from "../../hooks/useFlightCompletionState";
import type { JournalFlight } from "../../lib/journalMockData";
import styles from "../../journal/Journal.module.css";
import JournalFlightMap from "./JournalFlightMap";
import JournalFlightTitle from "./JournalFlightTitle";
import { buildFactualFlightLabel } from "../../lib/journalFlightTitle";
import { exportBcFlight } from "../../lib/bcFlightExport";
import { IndexedDbRecordedFlightStorage } from "../../lib/recordedFlightStorage";
import { persistJournalFlightNotes } from "../../lib/flightCompletionStorage";
import { useUnitPreferences } from "../../contexts/UnitPreferencesContext";
import { formatFlightAltitude, formatFlightDistance, formatFlightSpeed } from "../../lib/unitPreferences";
import FlightNoteDialog from "./FlightNoteDialog";

export default function JournalFlightDetail({ flightId, initialFlight }: { flightId: string; initialFlight: JournalFlight | null }) {
  const units = useUnitPreferences();
  const state = useFlightCompletionState();
  const flight = state.journalFlights.find(({ id }) => id === flightId) ?? initialFlight;
  const [noteEditorOpen, setNoteEditorOpen] = useState(false);
  const [displayedNote, setDisplayedNote] = useState<string | null>(flight?.notes ?? null);
  useEffect(() => setDisplayedNote(flight?.notes ?? null), [flight?.notes]);
  if (!flight) return <main className={styles.screen}><div className={styles.layout}><Link href="/journal" className={styles.backLink}>← Journal</Link><p>Vol introuvable sur cet appareil.</p></div><NavigationBar activeItem="Journal" /></main>;
  const ids = [...new Set([...state.journalFlights.map(({ id }) => id), flight.id])];
  const completionFlight = state.journalFlights.find(({ id }) => id === flight.id);
  const linkedAscension = state.officialAscensions.find(({ sourceFlightId }) => sourceFlightId === flight.id);
  const routeName = `${flight.departure} → ${flight.arrival}`;
  const factualName = buildFactualFlightLabel(flight);
  const handleExportTileClick = async () => {
    try {
      const recordedFlight = await new IndexedDbRecordedFlightStorage().getFlight(flight.id);
      if (!recordedFlight) {
        window.alert("La trace de ce vol n’est pas disponible pour l’export.");
        return;
      }
      await exportBcFlight(recordedFlight);
    } catch (error) {
      console.error("Export du vol impossible", error);
      window.alert("Impossible d’exporter ce vol. Réessayez depuis Safari.");
    }
  };
  const saveNote = async (notes: string | null) => {
    if (flight.origin === "REAL_GPS") {
      const sourceFlightId = (flight as JournalFlight & { sourceFlightId?: string }).sourceFlightId ?? flight.id;
      const updated = await new IndexedDbRecordedFlightStorage().updateFlightNotes(sourceFlightId, notes);
      if (!updated) throw new Error("RecordedFlight introuvable");
    }
    persistJournalFlightNotes(flight.id, notes);
    setDisplayedNote(notes);
    setNoteEditorOpen(false);
  };
  return <main id="flight-detail-top" className={styles.screen}><div className={styles.layout}>
    <Link href="/journal" className={styles.backLink}>← Journal</Link>
    <header className={styles.detailHeader}><JournalFlightTitle flightId={flight.id} automaticName={routeName} secondaryName={factualName} availableFlightIds={ids} className={styles.routeTitle} secondaryClassName={styles.automaticRouteTitle} /><p className={styles.dateLine}>{flight.date} · Décollage {flight.takeoffTime}</p><div className={styles.primaryMetrics}><p><span>Durée</span><strong>{flight.durationMinutes} min</strong></p><p><span>Distance</span><strong>{formatFlightDistance(flight.distanceKm, units.flightInstruments.distanceUnit)}</strong></p></div></header>
    <JournalFlightMap flight={flight} />
    {completionFlight && <section className={styles.logbookLinkCard}><div><span>Carnet d’ascensions</span><strong>{completionFlight.logbookStatus === "CARNET_VALIDATED" ? "Carnet validé" : completionFlight.logbookStatus === "JOURNAL_ONLY" ? "Journal uniquement" : "À valider"}</strong></div>{completionFlight.logbookStatus === "CARNET_VALIDATED" && linkedAscension ? <div><Link href={`/journal/ascension/${encodeURIComponent(linkedAscension.id)}`}>Voir l’ascension</Link><Link href={`/flight/complete/ascension?flightId=${encodeURIComponent(flight.id)}`}>Modifier l’ascension</Link></div> : <Link href={`/flight/complete/ascension?flightId=${encodeURIComponent(flight.id)}`}>Ajouter au carnet</Link>}</section>}
    <section className={styles.moduleGrid} aria-label="Informations du vol">
      <Link href={`/journal/${flight.id}/graphs`} className={`${styles.moduleCard} ${styles.moduleLink}`}><h2 className={styles.moduleTitle}><BarChart3 size={16} /> Graphiques</h2><p className={styles.moduleValue}>Altitude · Vitesse</p><p className={styles.moduleAction}><span>Voir les graphiques</span><ChevronRight size={15} /></p></Link>
      <Link href={`/journal/${flight.id}/statistics`} className={`${styles.moduleCard} ${styles.moduleLink}`}><h2 className={styles.moduleTitle}><Gauge size={16} /> Statistiques</h2><div className={styles.statGrid}><p><span>Départ</span><strong>{flight.takeoffTime}</strong></p><p><span>Arrivée</span><strong>{flight.landingTime}</strong></p><p><span>Altitude max</span><strong>{flight.maxAltitudeM === null ? "—" : formatFlightAltitude(flight.maxAltitudeM, units.flightInstruments.altitudeUnit)}</strong></p><p><span>Vitesse max</span><strong>{flight.maxSpeedKmh === null ? "—" : formatFlightSpeed(flight.maxSpeedKmh, units.flightInstruments.speedUnit)}</strong></p></div><p className={styles.moduleAction}><span>Voir toutes les statistiques</span><ChevronRight size={15} /></p></Link>
      <article className={`${styles.moduleCard} ${styles.moduleLink}`} role="button" tabIndex={0} aria-label={displayedNote ? "Modifier la note de vol" : "Ajouter une note de vol"} onClick={() => setNoteEditorOpen(true)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setNoteEditorOpen(true); } }}><h2 className={styles.moduleTitle}><NotebookPen size={16} /> Notes</h2><p className={`${styles.moduleValue} ${styles.flightNotePreview}`}>{displayedNote ?? "Aucune note"}</p><span className={styles.moduleTextAction} aria-hidden="true">{displayedNote ? "Modifier" : "Ajouter une note"}</span></article>
      <article className={`${styles.moduleCard} ${styles.moduleLink}`} role="button" tabIndex={0} onClick={() => void handleExportTileClick()} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") void handleExportTileClick(); }}><h2 className={styles.moduleTitle}><FileDown size={16} /> Export</h2><p className={styles.moduleValue}>Balloon Companion</p><p className={styles.moduleHint}>.bcflight</p></article>
    </section>
  </div>{noteEditorOpen && <FlightNoteDialog initialNote={displayedNote ?? ""} onCancel={() => setNoteEditorOpen(false)} onSave={saveNote} />}<NavigationBar activeItem="Journal" /></main>;
}

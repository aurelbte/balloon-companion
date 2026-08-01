"use client";

import Link from "next/link";
import {
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ChevronRight,
  Pencil,
  Plus,
  Search,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import {
  loadAscensionDemoState,
  saveAscensionDemoState,
  type AscensionDemoState,
} from "../../lib/ascensionDemoStorage";
import {
  formatOfficialDuration,
  getAscensionAutomaticName,
  type Ascension,
  type AscensionBalloonType,
  type AscensionFlightType,
  type AscensionFunction,
} from "../../lib/ascensionMockData";
import {
  calculatePilotOfficialTotals,
  removeOfficialAscension,
} from "../../lib/flightCompletion";
import { saveFlightCompletionState } from "../../lib/flightCompletionStorage";
import { useFlightCompletionState } from "../../hooks/useFlightCompletionState";
import DeleteFlightDialog from "./DeleteFlightDialog";
import styles from "../../journal/Journal.module.css";

type DateFilter = "all" | "today" | "30-days" | "this-year" | "year" | "date";
type ValueFilter<T extends string> = "all" | T;

const LONG_PRESS_MS = 500;
const EMPTY_STATE: AscensionDemoState = { version: 1, deletedIds: [], customTitles: {} };

function normalize(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function localIsoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function matchesDate(
  dateIso: string,
  filter: DateFilter,
  year: string,
  exactDate: string,
): boolean {
  const now = new Date();
  if (filter === "all") return true;
  if (filter === "today") return dateIso === localIsoDate(now);
  if (filter === "this-year") return dateIso.startsWith(`${now.getFullYear()}-`);
  if (filter === "year") return Boolean(year) && dateIso.startsWith(`${year}-`);
  if (filter === "date") return Boolean(exactDate) && dateIso === exactDate;
  const threshold = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30);
  return new Date(`${dateIso}T12:00:00`) >= threshold && new Date(`${dateIso}T12:00:00`) <= now;
}

type AscensionCardProps = {
  ascension: Ascension;
  title: string;
  menuOpen: boolean;
  onOpenMenu: (trigger: HTMLElement) => void;
  onCloseMenu: () => void;
  onRename: () => void;
  onDelete: () => void;
};

function AscensionCard({
  ascension,
  title,
  menuOpen,
  onOpenMenu,
  onCloseMenu,
  onRename,
  onDelete,
}: AscensionCardProps) {
  const linkRef = useRef<HTMLAnchorElement>(null);
  const timerRef = useRef<number | null>(null);
  const originRef = useRef<{ x: number; y: number } | null>(null);
  const longPressedRef = useRef(false);

  const cancel = () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    originRef.current = null;
  };

  const start = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    cancel();
    longPressedRef.current = false;
    originRef.current = { x: event.clientX, y: event.clientY };
    timerRef.current = window.setTimeout(() => {
      longPressedRef.current = true;
      if (linkRef.current) onOpenMenu(linkRef.current);
    }, LONG_PRESS_MS);
  };

  return (
    <article
      className={styles.ascensionCardShell}
      onPointerDown={start}
      onPointerMove={(event) => {
        const origin = originRef.current;
        if (origin && Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 9) cancel();
      }}
      onPointerUp={cancel}
      onPointerCancel={cancel}
      onContextMenu={(event) => {
        event.preventDefault();
        cancel();
        if (linkRef.current) onOpenMenu(linkRef.current);
      }}
    >
      <Link
        ref={linkRef}
        href={`/journal/ascension/${ascension.id}`}
        className={`${styles.ascensionCard} ${menuOpen ? styles.flightCardSelected : ""}`}
        aria-label={`Ouvrir l’ascension ${title}`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={(event) => {
          if (longPressedRef.current || menuOpen) {
            event.preventDefault();
            longPressedRef.current = false;
          }
        }}
      >
        <div className={styles.ascensionMain}>
          <p className={styles.flightDate}>{ascension.date}</p>
          <h3 className={styles.ascensionRoute}>{title}</h3>
          <p className={styles.ascensionMeta}>
            <span>{ascension.function}</span>
            <span>{ascension.registration}</span>
            <span>{formatOfficialDuration(ascension.officialDurationMinutes)}</span>
          </p>
        </div>
        <ChevronRight size={19} aria-hidden="true" />
      </Link>
      {menuOpen && (
        <div className={styles.flightActionMenu} role="menu" aria-label={`Actions pour ${title}`}>
          <button type="button" role="menuitem" onClick={onRename}><Pencil size={16} aria-hidden="true" /> Renommer</button>
          <button type="button" role="menuitem" onClick={onDelete}><Trash2 size={16} aria-hidden="true" /> Supprimer</button>
        </div>
      )}
      {menuOpen && <button type="button" className={styles.menuDismiss} aria-label="Fermer le menu" onClick={onCloseMenu} />}
    </article>
  );
}

export default function AscensionLog({ ascensions }: { ascensions: readonly Ascension[] }) {
  const completionState = useFlightCompletionState();
  const [state, setState] = useState<AscensionDemoState>(EMPTY_STATE);
  const [query, setQuery] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [year, setYear] = useState("");
  const [exactDate, setExactDate] = useState("");
  const [registration, setRegistration] = useState("all");
  const [functionFilter, setFunctionFilter] = useState<ValueFilter<AscensionFunction>>("all");
  const [flightType, setFlightType] = useState<ValueFilter<AscensionFlightType>>("all");
  const [balloonType, setBalloonType] = useState<ValueFilter<AscensionBalloonType>>("all");
  const [menuId, setMenuId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<Ascension | null>(null);
  const [deleting, setDeleting] = useState<Ascension | null>(null);
  const [addedToast, setAddedToast] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(
      () => setState(loadAscensionDemoState([
        ...ascensions.map(({ id }) => id),
        ...completionState.officialAscensions.map(({ id }) => id),
      ])),
      0,
    );
    return () => window.clearTimeout(timer);
  }, [ascensions, completionState.officialAscensions]);
  useEffect(() => {
    if (window.sessionStorage.getItem("balloon-companion-ascension-added") !== "1") return;
    window.sessionStorage.removeItem("balloon-companion-ascension-added");
    const showTimer = window.setTimeout(() => setAddedToast(true), 0);
    const hideTimer = window.setTimeout(() => setAddedToast(false), 2200);
    return () => { window.clearTimeout(showTimer); window.clearTimeout(hideTimer); };
  }, []);
  useEffect(() => {
    if (!menuId) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuId(null);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [menuId]);

  const completionAscensions = useMemo<Ascension[]>(
    () => completionState.officialAscensions.map((item) => ({
      id: item.id,
      date: item.date,
      dateIso: item.dateIso,
      departure: item.departure,
      arrival: item.arrival,
      registration: item.registration,
      balloonModel: item.balloonModel,
      balloonType: item.category === "Libre à gaz" ? "Gaz" : "Air chaud",
      function: item.pilotFunction,
      flightType: item.nightFlight ? "Nuit" : "Jour",
      maximumAltitudeM: item.maximumAltitudeM,
      officialDurationMinutes: item.officialDurationMinutes,
      observations: item.observations,
    })),
    [completionState.officialAscensions],
  );
  const allAscensions = useMemo(
    () => [
      ...completionAscensions,
      ...ascensions.filter(
        (item) => !completionAscensions.some(({ id }) => id === item.id),
      ),
    ],
    [ascensions, completionAscensions],
  );
  const available = useMemo(
    () => allAscensions.filter(({ id }) => !state.deletedIds.includes(id)),
    [allAscensions, state.deletedIds],
  );
  const registrations = [...new Set(available.map((item) => item.registration))].sort();
  const years = [...new Set(available.map((item) => item.dateIso.slice(0, 4)))].sort().reverse();
  const filtersActive = dateFilter !== "all" || registration !== "all" || functionFilter !== "all" || flightType !== "all" || balloonType !== "all";
  const normalizedQuery = normalize(query);
  const filtered = available.filter((item) => {
    const title = state.customTitles[item.id] ?? getAscensionAutomaticName(item);
    const searchable = normalize([title, item.date, item.departure, item.arrival, item.registration, item.balloonModel, item.observations].join(" "));
    return (!normalizedQuery || searchable.includes(normalizedQuery)) &&
      matchesDate(item.dateIso, dateFilter, year, exactDate) &&
      (registration === "all" || item.registration === registration) &&
      (functionFilter === "all" || item.function === functionFilter) &&
      (flightType === "all" || item.flightType === flightType) &&
      (balloonType === "all" || item.balloonType === balloonType);
  });
  const officialTotals = calculatePilotOfficialTotals(completionState);

  const resetFilters = () => {
    setDateFilter("all"); setYear(""); setExactDate(""); setRegistration("all");
    setFunctionFilter("all"); setFlightType("all"); setBalloonType("all");
  };

  return (
    <section className={styles.logbookView} aria-labelledby="logbook-title">
      <div className={styles.logbookHeading}>
        <p className={styles.eyebrow}>Registre pilote</p><h2 id="logbook-title">Carnet d’ascensions</h2>
      </div>

      <div className={styles.logbookSummary}>
        <p><strong>{officialTotals.ascensions ?? "—"}</strong><span>Ascensions</span></p>
        <p><strong>{officialTotals.officialDurationMinutes === null ? "—" : formatOfficialDuration(officialTotals.officialDurationMinutes)}</strong><span>Temps officiel</span></p>
      </div>
      {!completionState.openingBalance.confirmed && (
        <Link href="/more/profile/experience" className={styles.experienceMissing}>
          <span>Expérience antérieure non renseignée</span><strong>Compléter →</strong>
        </Link>
      )}
      <Link href="/journal/ascension/new" className={styles.addAscensionButton}><Plus size={17} aria-hidden="true" /> Ajouter une ascension</Link>

      <div className={styles.journalToolbar}>
        <label className={styles.searchField}><Search size={17} aria-hidden="true" /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rechercher une ascension..." aria-label="Rechercher une ascension" /></label>
        <button type="button" className={styles.filterButton} onClick={() => setFiltersOpen((open) => !open)} aria-expanded={filtersOpen}><SlidersHorizontal size={18} aria-hidden="true" /><span>Filtres</span>{filtersActive && <span className={styles.filterIndicator} aria-label="Filtres actifs" />}</button>
      </div>

      {filtersOpen && <div className={styles.filterPanel}>
        <label><span>Date</span><select value={dateFilter} onChange={(event) => setDateFilter(event.target.value as DateFilter)}><option value="all">Toutes</option><option value="today">Aujourd’hui</option><option value="30-days">30 jours</option><option value="this-year">Cette année</option><option value="year">Choisir une année</option><option value="date">Choisir une date</option></select></label>
        {dateFilter === "year" && <label><span>Année</span><select value={year} onChange={(event) => setYear(event.target.value)}><option value="">Sélectionner</option>{years.map((value) => <option key={value}>{value}</option>)}</select></label>}
        {dateFilter === "date" && <label><span>Date précise</span><input type="date" value={exactDate} onChange={(event) => setExactDate(event.target.value)} /></label>}
        <label><span>Ballon</span><select value={registration} onChange={(event) => setRegistration(event.target.value)}><option value="all">Tous</option>{registrations.map((value) => <option key={value}>{value}</option>)}</select></label>
        <label><span>Fonction</span><select value={functionFilter} onChange={(event) => setFunctionFilter(event.target.value as ValueFilter<AscensionFunction>)}><option value="all">Tous</option><option value="Pilote">Pilote</option><option value="Élève">Élève</option></select></label>
        <label><span>Vol</span><select value={flightType} onChange={(event) => setFlightType(event.target.value as ValueFilter<AscensionFlightType>)}><option value="all">Tous</option><option value="Jour">Jour</option><option value="Nuit">Nuit</option></select></label>
        <label><span>Type</span><select value={balloonType} onChange={(event) => setBalloonType(event.target.value as ValueFilter<AscensionBalloonType>)}><option value="all">Tous</option><option value="Air chaud">Air chaud</option><option value="Gaz">Gaz</option></select></label>
        <button type="button" className={styles.resetFilters} disabled={!filtersActive} onClick={resetFilters}>Réinitialiser</button>
      </div>}

      <div className={styles.ascensionList} aria-label="Ascensions">
        {filtered.map((ascension) => <AscensionCard key={ascension.id} ascension={ascension} title={state.customTitles[ascension.id] ?? getAscensionAutomaticName(ascension)} menuOpen={menuId === ascension.id} onOpenMenu={() => setMenuId(ascension.id)} onCloseMenu={() => setMenuId(null)} onRename={() => { setRenaming(ascension); setMenuId(null); }} onDelete={() => { setDeleting(ascension); setMenuId(null); }} />)}
        {filtered.length === 0 && <p className={styles.emptyState}>Aucune ascension trouvée.</p>}
      </div>

      {renaming && <AscensionRenameDialog initialTitle={state.customTitles[renaming.id] ?? getAscensionAutomaticName(renaming)} onCancel={() => setRenaming(null)} onConfirm={(title) => { const next = { ...state, customTitles: { ...state.customTitles, [renaming.id]: title } }; saveAscensionDemoState(next); setState(next); setRenaming(null); }} />}
      {deleting && <DeleteFlightDialog entityLabel="ascension" flightName={state.customTitles[deleting.id] ?? getAscensionAutomaticName(deleting)} returnFocusTo={null} onCancel={() => setDeleting(null)} onConfirm={() => {
        if (completionState.officialAscensions.some(({ id }) => id === deleting.id)) {
          saveFlightCompletionState(removeOfficialAscension(completionState, deleting.id));
        } else {
          const next = { ...state, deletedIds: [...new Set([...state.deletedIds, deleting.id])] };
          saveAscensionDemoState(next); setState(next);
        }
        setDeleting(null);
      }} />}
      <p role="status" aria-live="polite" className={`${styles.toast} ${addedToast ? styles.toastVisible : ""}`}>Ascension ajoutée</p>
    </section>
  );
}

function AscensionRenameDialog({ initialTitle, onCancel, onConfirm }: { initialTitle: string; onCancel: () => void; onConfirm: (title: string) => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [title, setTitle] = useState(initialTitle);
  const trimmed = title.trim();
  useEffect(() => { dialogRef.current?.showModal(); }, []);
  return <dialog ref={dialogRef} className={styles.ascensionDialog} onCancel={(event) => { event.preventDefault(); onCancel(); }}><h2>Renommer l’ascension</h2><input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} aria-label="Titre personnel" /><div><button type="button" onClick={onCancel}>Annuler</button><button type="button" disabled={!trimmed} onClick={() => onConfirm(trimmed)}>Enregistrer</button></div></dialog>;
}

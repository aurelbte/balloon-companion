"use client";

import Link from "next/link";
import {
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  ChevronRight,
  MoreHorizontal,
  Plus,
  Search,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
  formatOfficialDuration,
  getAscensionAutomaticName,
  type Ascension,
  type AscensionBalloonType,
  type AscensionFlightType,
  type AscensionFunction,
  sortAscensionsNewestFirst,
} from "../../lib/ascensionMockData";
import {
  calculatePilotOfficialTotals,
  removeOfficialAscension,
} from "../../lib/flightCompletion";
import { saveFlightCompletionState } from "../../lib/flightCompletionStorage";
import { officialAscensionRegulatoryRoleLabel } from "../../lib/officialAscensionPresentation";
import { useFlightCompletionState } from "../../hooks/useFlightCompletionState";
import { useJournalCardSwipe } from "../../hooks/useJournalCardSwipe";
import DeleteFlightDialog from "./DeleteFlightDialog";
import styles from "../../journal/Journal.module.css";

type DateFilter = "all" | "today" | "30-days" | "this-year" | "year" | "date";
type ValueFilter<T extends string> = "all" | T;

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
  swipeOpen: boolean;
  onSetSwipeOpen: (open: boolean) => void;
  onOpenMenu: (trigger: HTMLElement) => void;
  onCloseMenu: () => void;
  onDelete: () => void;
};

function AscensionCard({
  ascension,
  title,
  menuOpen,
  swipeOpen,
  onSetSwipeOpen,
  onOpenMenu,
  onCloseMenu,
  onDelete,
}: AscensionCardProps) {
  const router = useRouter();
  const {
    contentRef,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onTransitionEnd,
    onContentClick,
  } = useJournalCardSwipe({ open: swipeOpen, onSetOpen: onSetSwipeOpen });

  return (
    <article className={`${styles.flightCardShell} ${styles.ascensionCardShell}`} data-journal-ascension-shell>
      <div className={`${styles.flightSwipeActions} ${styles.ascensionSwipeActions}`} aria-hidden={!swipeOpen}><button type="button" tabIndex={swipeOpen ? 0 : -1} onClick={onDelete} aria-label={`Supprimer l’ascension du ${ascension.date}`}><Trash2 size={18} />Supprimer</button></div>
      <div
        ref={contentRef}
        role="link"
        tabIndex={0}
        className={`${styles.ascensionCard} ${menuOpen ? styles.flightCardSelected : ""}`}
        aria-label={`Ouvrir l’ascension ${title}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onTransitionEnd={(event) => {
          onTransitionEnd(event.propertyName, event.currentTarget);
        }}
        onClick={() => onContentClick(() => router.push(`/journal/ascension/${ascension.id}`))}
        onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); router.push(`/journal/ascension/${ascension.id}`); } }}
      >
        <div className={styles.ascensionMain}>
          <div className={styles.flightCardHeader}><p className={styles.flightDate}>{ascension.date}</p><button type="button" className={styles.flightMoreButton} aria-label={`Actions pour l’ascension du ${ascension.date}`} aria-haspopup="menu" aria-expanded={menuOpen} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onOpenMenu(event.currentTarget); }}><MoreHorizontal size={19} /></button></div>
          <h3 className={styles.ascensionRoute}>{title}</h3>
          <p className={styles.ascensionMeta}>
            <span>{ascension.function}</span>
            <span>{ascension.registration}</span>
            <span>{formatOfficialDuration(ascension.officialDurationMinutes)}</span>
          </p>
        </div>
        <ChevronRight size={19} aria-hidden="true" />
      </div>
      {menuOpen && (
        <div className={styles.flightActionMenu} role="menu" aria-label={`Actions pour ${title}`}>
          <button type="button" role="menuitem" onClick={onDelete}><Trash2 size={16} aria-hidden="true" /> Supprimer</button>
        </div>
      )}
      {menuOpen && <button type="button" className={styles.menuDismiss} aria-label="Fermer le menu" onClick={onCloseMenu} />}
    </article>
  );
}

export default function AscensionLog() {
  const completionState = useFlightCompletionState();
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
  const [openSwipeId, setOpenSwipeId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Ascension | null>(null);
  const [addedToast, setAddedToast] = useState(false);

  useEffect(() => {
    if (!openSwipeId) return;
    const closeSwipeFromOutside = (event: PointerEvent) => {
      if (!(event.target as Element).closest?.("[data-journal-ascension-shell]")) {
        setOpenSwipeId(null);
      }
    };
    document.addEventListener("pointerdown", closeSwipeFromOutside);
    return () => document.removeEventListener("pointerdown", closeSwipeFromOutside);
  }, [openSwipeId]);

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
      time: item.sourceFlightId
        ? completionState.journalFlights.find(({ id }) => id === item.sourceFlightId)?.takeoffTime
        : undefined,
      departure: item.departure,
      arrival: item.arrival,
      registration: item.registration,
      balloonModel: item.balloonModel,
      balloonType: item.category === "Libre à gaz" ? "Gaz" : "Air chaud",
      function: officialAscensionRegulatoryRoleLabel(item),
      flightType: item.nightFlight ? "Nuit" : "Jour",
      maximumAltitudeM: item.maximumAltitudeM,
      officialDurationMinutes: item.officialDurationMinutes,
      observations: item.observations,
    })),
    [completionState.journalFlights, completionState.officialAscensions],
  );
  const allAscensions = completionAscensions;
  const available = useMemo(
    () => sortAscensionsNewestFirst(allAscensions),
    [allAscensions],
  );
  const registrations = [...new Set(available.map((item) => item.registration))].sort();
  const years = [...new Set(available.map((item) => item.dateIso.slice(0, 4)))].sort().reverse();
  const filtersActive = dateFilter !== "all" || registration !== "all" || functionFilter !== "all" || flightType !== "all" || balloonType !== "all";
  const normalizedQuery = normalize(query);
  const filtered = available.filter((item) => {
    const title = getAscensionAutomaticName(item);
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
        <label className={styles.searchField}><Search size={17} aria-hidden="true" /><input type="search" enterKeyHint="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rechercher une ascension..." aria-label="Rechercher une ascension" /></label>
        <button type="button" className={styles.filterButton} onClick={() => setFiltersOpen((open) => !open)} aria-expanded={filtersOpen}><SlidersHorizontal size={18} aria-hidden="true" /><span>Filtres</span>{filtersActive && <span className={styles.filterIndicator} aria-label="Filtres actifs" />}</button>
      </div>

      {filtersOpen && <div className={styles.filterPanel}>
        <label><span>Date</span><select value={dateFilter} onChange={(event) => setDateFilter(event.target.value as DateFilter)}><option value="all">Toutes</option><option value="today">Aujourd’hui</option><option value="30-days">30 jours</option><option value="this-year">Cette année</option><option value="year">Choisir une année</option><option value="date">Choisir une date</option></select></label>
        {dateFilter === "year" && <label><span>Année</span><select value={year} onChange={(event) => setYear(event.target.value)}><option value="">Sélectionner</option>{years.map((value) => <option key={value}>{value}</option>)}</select></label>}
        {dateFilter === "date" && <label><span>Date précise</span><input type="date" value={exactDate} onChange={(event) => setExactDate(event.target.value)} /></label>}
        <label><span>Ballon</span><select value={registration} onChange={(event) => setRegistration(event.target.value)}><option value="all">Tous</option>{registrations.map((value) => <option key={value}>{value}</option>)}</select></label>
        <label><span>Fonction</span><select value={functionFilter} onChange={(event) => setFunctionFilter(event.target.value as ValueFilter<AscensionFunction>)}><option value="all">Tous</option><option value="Commandant de bord (PIC)">Commandant de bord (PIC)</option><option value="Double commande">Double commande</option><option value="Instructeur FI(B)">Instructeur FI(B)</option><option value="Examinateur FE(B)">Examinateur FE(B)</option><option value="Pilote">Pilote (historique)</option><option value="Élève">Élève (historique)</option></select></label>
        <label><span>Vol</span><select value={flightType} onChange={(event) => setFlightType(event.target.value as ValueFilter<AscensionFlightType>)}><option value="all">Tous</option><option value="Jour">Jour</option><option value="Nuit">Nuit</option></select></label>
        <label><span>Type</span><select value={balloonType} onChange={(event) => setBalloonType(event.target.value as ValueFilter<AscensionBalloonType>)}><option value="all">Tous</option><option value="Air chaud">Air chaud</option><option value="Gaz">Gaz</option></select></label>
        <button type="button" className={styles.resetFilters} disabled={!filtersActive} onClick={resetFilters}>Réinitialiser</button>
      </div>}

      <div className={styles.ascensionList} aria-label="Ascensions">
        {filtered.map((ascension) => <AscensionCard key={ascension.id} ascension={ascension} title={getAscensionAutomaticName(ascension)} menuOpen={menuId === ascension.id} swipeOpen={openSwipeId === ascension.id} onSetSwipeOpen={(open) => { setOpenSwipeId(open ? ascension.id : null); if (open) setMenuId(null); }} onOpenMenu={() => { setOpenSwipeId(null); setMenuId(ascension.id); }} onCloseMenu={() => setMenuId(null)} onDelete={() => { setDeleting(ascension); setOpenSwipeId(null); setMenuId(null); }} />)}
        {filtered.length === 0 && <p className={styles.emptyState}>Aucune ascension trouvée.</p>}
      </div>

      {deleting && <DeleteFlightDialog entityLabel="ascension" flightName={getAscensionAutomaticName(deleting)} linkedAscension={Boolean(completionState.officialAscensions.find(({ id }) => id === deleting.id)?.sourceFlightId)} returnFocusTo={null} onCancel={() => setDeleting(null)} onConfirm={() => {
        saveFlightCompletionState(removeOfficialAscension(completionState, deleting.id));
        setDeleting(null);
      }} />}
      <p role="status" aria-live="polite" className={`${styles.toast} ${addedToast ? styles.toastVisible : ""}`}>Ascension ajoutée</p>
    </section>
  );
}

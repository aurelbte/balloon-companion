"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { MoreHorizontal, Pencil, Search, SlidersHorizontal, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useFlightCompletionState } from "../../hooks/useFlightCompletionState";
import {
  loadJournalDemoState,
  saveJournalDemoState,
  type JournalDemoState,
} from "../../lib/journalDemoStorage";
import type { JournalFlight } from "../../lib/journalMockData";
import DeleteFlightDialog from "./DeleteFlightDialog";
import JournalTraceThumbnail from "./JournalTraceThumbnail";
import RenameFlightDialog from "./RenameFlightDialog";
import styles from "../../journal/Journal.module.css";
import { deleteRecordedJournalFlight, migrateCompletedRecordedFlightsToJournal, persistJournalFlightCustomTitle } from "../../lib/flightCompletionStorage";
import { journalFlightsForMode } from "../../lib/realFlightJournal";
import { buildFactualFlightLabel, getJournalFlightDisplayTitle } from "../../lib/journalFlightTitle";
import { useJournalCardSwipe } from "../../hooks/useJournalCardSwipe";

type DateFilter = "all" | "today" | "30-days" | "this-year" | "year" | "date";
type DurationFilter = "all" | "under-45" | "45-to-60" | "over-60";
type SortOrder = "recent" | "oldest" | "duration" | "distance";

const EMPTY_STATE: JournalDemoState = {
  version: 2,
  deletedFlightIds: [],
  customNames: {},
};

const DISTANCE_FORMATTER = new Intl.NumberFormat("fr-FR", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

function normalizeSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("fr-FR")
    .trim();
}

function startOfDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function toLocalIsoDate(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function matchesDate(
  dateIso: string,
  filter: DateFilter,
  now: Date,
  selectedYear: string,
  selectedDate: string,
): boolean {
  if (filter === "all") return true;
  const date = new Date(`${dateIso}T12:00:00`);
  if (filter === "today") return dateIso === toLocalIsoDate(now);
  if (filter === "this-year") return date.getFullYear() === now.getFullYear();
  if (filter === "year") return Boolean(selectedYear) && dateIso.startsWith(`${selectedYear}-`);
  if (filter === "date") return Boolean(selectedDate) && dateIso === selectedDate;
  const threshold = startOfDay(now);
  threshold.setDate(threshold.getDate() - 30);
  return date >= threshold && date <= now;
}

function matchesDuration(duration: number, filter: DurationFilter): boolean {
  if (filter === "under-45") return duration < 45;
  if (filter === "45-to-60") return duration >= 45 && duration <= 60;
  if (filter === "over-60") return duration > 60;
  return true;
}

type FlightActionMenuProps = {
  flightName: string;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
};

function FlightActionMenu({
  flightName,
  onClose,
  onEdit,
  onDelete,
}: FlightActionMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const firstActionRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    firstActionRef.current?.focus();
    const closeFromOutside = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    };
    const closeFromKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", closeFromOutside);
    document.addEventListener("keydown", closeFromKeyboard);
    return () => {
      document.removeEventListener("pointerdown", closeFromOutside);
      document.removeEventListener("keydown", closeFromKeyboard);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      className={styles.flightActionMenu}
      role="menu"
      aria-label={`Actions pour ${flightName}`}
    >
      <button ref={firstActionRef} type="button" role="menuitem" onClick={onEdit}>
        <Pencil size={16} aria-hidden="true" /> Modifier
      </button>
      <button type="button" role="menuitem" onClick={onDelete}>
        <Trash2 size={16} aria-hidden="true" /> Supprimer
      </button>
    </div>
  );
}

type InteractiveFlightCardProps = {
  flight: JournalFlight;
  displayName: string;
  customized: boolean;
  menuOpen: boolean;
  swipeOpen: boolean;
  onSetSwipeOpen: (open: boolean) => void;
  onOpenMenu: (trigger: HTMLElement) => void;
  onCloseMenu: () => void;
  onEdit: () => void;
  onDelete: () => void;
};

function InteractiveFlightCard({
  flight,
  displayName,
  customized,
  menuOpen,
  swipeOpen,
  onSetSwipeOpen,
  onOpenMenu,
  onCloseMenu,
  onEdit,
  onDelete,
}: InteractiveFlightCardProps) {
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
    <article className={styles.flightCardShell} data-journal-flight-shell>
      <div className={styles.flightSwipeActions} aria-hidden={!swipeOpen}><button type="button" tabIndex={swipeOpen ? 0 : -1} onClick={onEdit} aria-label={`Modifier le vol du ${flight.date}`}><Pencil size={18} />Modifier</button><button type="button" tabIndex={swipeOpen ? 0 : -1} onClick={onDelete} aria-label={`Supprimer le vol du ${flight.date}`}><Trash2 size={18} />Supprimer</button></div>
      <div
        ref={contentRef}
        role="link"
        tabIndex={0}
        className={`${styles.flightCard} ${menuOpen ? styles.flightCardSelected : ""}`}
        aria-label={`Ouvrir le vol ${displayName}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onTransitionEnd={(event) => {
          onTransitionEnd(event.propertyName, event.currentTarget);
        }}
        onClick={() => {
          onContentClick(() => router.push(`/journal/${flight.id}`));
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") { event.preventDefault(); router.push(`/journal/${flight.id}`); }
        }}
      >
        <div className={styles.flightCardHeader}>
          <p className={styles.flightDate}>{flight.date}</p>
          <button type="button" className={styles.flightMoreButton} aria-label={`Actions pour le vol du ${flight.date}`} aria-haspopup="menu" aria-expanded={menuOpen} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onOpenMenu(event.currentTarget); }}><MoreHorizontal size={19} /></button>
        </div>
        <div className={styles.flightCardBody}>
          <div className={styles.flightCardInformation}>
          <h2 className={styles.flightRoute}>{displayName}</h2>
          <p className={styles.flightTakeoffTime}>{customized ? buildFactualFlightLabel(flight) : `Décollage ${flight.takeoffTime}`}</p>
          <div className={styles.flightMetrics}>
            <span>{flight.durationMinutes} min</span>
            <span>{DISTANCE_FORMATTER.format(flight.distanceKm)} km</span>
            {"logbookStatus" in flight && <span className={styles.pendingLogbook}>{flight.logbookStatus === "CARNET_VALIDATED" ? "CARNET ✓" : flight.logbookStatus === "JOURNAL_ONLY" ? "JOURNAL" : "À VALIDER"}</span>}
          </div>
          </div>
          <div className={styles.thumbnail}>
          <JournalTraceThumbnail
            flight={flight}
            label={`Miniature de la trace ${flight.departure} vers ${flight.arrival}`}
          />
          </div>
        </div>
      </div>
      {menuOpen && (
        <FlightActionMenu
          flightName={displayName}
          onClose={onCloseMenu}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      )}
    </article>
  );
}

export default function JournalFlightList() {
  const completionState = useFlightCompletionState();
  const [demoState, setDemoState] = useState<JournalDemoState>(EMPTY_STATE);
  const [storageReady, setStorageReady] = useState(false);
  const [query, setQuery] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [selectedYear, setSelectedYear] = useState("");
  const [selectedDate, setSelectedDate] = useState("");
  const [terrain, setTerrain] = useState("all");
  const [balloon, setBalloon] = useState("all");
  const [duration, setDuration] = useState<DurationFilter>("all");
  const [sortOrder, setSortOrder] = useState<SortOrder>("recent");
  const [menuFlightId, setMenuFlightId] = useState<string | null>(null);
  const [openSwipeFlightId, setOpenSwipeFlightId] = useState<string | null>(null);
  const [pendingRename, setPendingRename] = useState<JournalFlight | null>(null);
  const [pendingDelete, setPendingDelete] = useState<JournalFlight | null>(null);
  const [actionTrigger, setActionTrigger] = useState<HTMLElement | null>(null);
  const [toastVisible, setToastVisible] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void migrateCompletedRecordedFlightsToJournal().catch((error: unknown) => {
        console.error("Migration non destructive des vols GPS impossible", error);
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const allFlights = useMemo(
    () => journalFlightsForMode(completionState.journalFlights, false),
    [completionState.journalFlights],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDemoState(loadJournalDemoState(allFlights.map((flight) => flight.id)));
      setStorageReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [allFlights]);

  useEffect(() => {
    if (!toastVisible) return;
    const timer = window.setTimeout(() => setToastVisible(false), 2200);
    return () => window.clearTimeout(timer);
  }, [toastVisible]);

  useEffect(() => {
    if (!openSwipeFlightId) return;
    const closeSwipeFromOutside = (event: PointerEvent) => {
      if (!(event.target as Element).closest?.("[data-journal-flight-shell]")) setOpenSwipeFlightId(null);
    };
    document.addEventListener("pointerdown", closeSwipeFromOutside);
    return () => document.removeEventListener("pointerdown", closeSwipeFromOutside);
  }, [openSwipeFlightId]);

  const availableFlights = useMemo(
    () =>
      allFlights.filter(
        (flight) => !demoState.deletedFlightIds.includes(flight.id),
      ),
    [allFlights, demoState.deletedFlightIds],
  );
  const departureTerrains = useMemo(
    () => [...new Set(availableFlights.map((flight) => flight.departure))].sort(),
    [availableFlights],
  );
  const arrivalTerrains = useMemo(
    () => [...new Set(availableFlights.map((flight) => flight.arrival))].sort(),
    [availableFlights],
  );
  const balloons = useMemo(
    () => [...new Set(availableFlights.map((flight) => flight.balloonRegistration))].sort(),
    [availableFlights],
  );
  const years = useMemo(
    () =>
      [...new Set(availableFlights.map((flight) => flight.dateIso.slice(0, 4)))].sort(
        (left, right) => right.localeCompare(left),
      ),
    [availableFlights],
  );
  const filtersActive =
    dateFilter !== "all" ||
    terrain !== "all" ||
    balloon !== "all" ||
    duration !== "all" ||
    sortOrder !== "recent";
  const normalizedQuery = normalizeSearch(query);
  const now = new Date();
  const visibleFlights = availableFlights
    .filter((flight) => {
      const displayName =
        demoState.customNames[flight.id] ?? getJournalFlightDisplayTitle(flight);
      const searchable = normalizeSearch(
        [displayName, flight.departure, flight.arrival, flight.date, flight.balloonRegistration].join(" "),
      );
      return !normalizedQuery || searchable.includes(normalizedQuery);
    })
    .filter((flight) =>
      matchesDate(flight.dateIso, dateFilter, now, selectedYear, selectedDate),
    )
    .filter((flight) => {
      if (terrain === "all") return true;
      const [direction, value] = terrain.split(":");
      return direction === "departure"
        ? flight.departure === value
        : flight.arrival === value;
    })
    .filter((flight) => balloon === "all" || flight.balloonRegistration === balloon)
    .filter((flight) => matchesDuration(flight.durationMinutes, duration))
    .sort((left, right) => {
      if (sortOrder === "oldest") return left.dateIso.localeCompare(right.dateIso);
      if (sortOrder === "duration") return right.durationMinutes - left.durationMinutes;
      if (sortOrder === "distance") return right.distanceKm - left.distanceKm;
      return right.dateIso.localeCompare(left.dateIso);
    });

  const summary = visibleFlights.reduce(
    (totals, flight) => ({
      minutes: totals.minutes + flight.durationMinutes,
      distanceKm: totals.distanceKm + flight.distanceKm,
    }),
    { minutes: 0, distanceKm: 0 },
  );

  const resetFilters = () => {
    setOpenSwipeFlightId(null);
    setDateFilter("all");
    setSelectedYear("");
    setSelectedDate("");
    setTerrain("all");
    setBalloon("all");
    setDuration("all");
    setSortOrder("recent");
  };

  return (
    <>
      <div className={styles.journalToolbar}>
        <label className={styles.searchField}>
          <Search size={17} aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => { setOpenSwipeFlightId(null); setQuery(event.target.value); }}
            placeholder="Rechercher un vol..."
            aria-label="Rechercher un vol"
            autoComplete="off"
          />
        </label>
        <button
          type="button"
          className={styles.filterButton}
          onClick={() => { setOpenSwipeFlightId(null); setFiltersOpen((current) => !current); }}
          aria-expanded={filtersOpen}
          aria-controls="journal-filters"
        >
          <SlidersHorizontal size={18} aria-hidden="true" />
          <span>Filtres</span>
          {filtersActive && <span className={styles.filterIndicator} aria-label="Filtres actifs" />}
        </button>
      </div>

      <div className={styles.journalSummary} aria-live="polite">
        <p><strong>{visibleFlights.length}</strong><span>vol{visibleFlights.length > 1 ? "s" : ""}</span></p>
        <p><strong>{Math.round(summary.minutes / 60)}</strong><span>h</span></p>
        <p><strong>{Math.round(summary.distanceKm)}</strong><span>km</span></p>
      </div>

      {filtersOpen && (
        <section id="journal-filters" className={styles.filterPanel} aria-label="Filtres des vols">
          <label><span>Date</span><select value={dateFilter} onChange={(event) => { setOpenSwipeFlightId(null); setDateFilter(event.target.value as DateFilter); }}><option value="all">Toutes</option><option value="today">Aujourd’hui</option><option value="30-days">30 derniers jours</option><option value="this-year">Cette année</option><option value="year">Choisir une année</option><option value="date">Choisir une date</option></select></label>
          {dateFilter === "year" && <label><span>Année</span><select value={selectedYear} onChange={(event) => { setOpenSwipeFlightId(null); setSelectedYear(event.target.value); }}><option value="">Sélectionner</option>{years.map((year) => <option key={year} value={year}>{year}</option>)}</select></label>}
          {dateFilter === "date" && <label><span>Date précise</span><input type="date" value={selectedDate} onChange={(event) => { setOpenSwipeFlightId(null); setSelectedDate(event.target.value); }} /></label>}
          <label><span>Terrain</span><select value={terrain} onChange={(event) => { setOpenSwipeFlightId(null); setTerrain(event.target.value); }}><option value="all">Tous</option><optgroup label="Départ">{departureTerrains.map((value) => <option key={`departure-${value}`} value={`departure:${value}`}>{value}</option>)}</optgroup><optgroup label="Arrivée">{arrivalTerrains.map((value) => <option key={`arrival-${value}`} value={`arrival:${value}`}>{value}</option>)}</optgroup></select></label>
          <label><span>Ballon</span><select value={balloon} onChange={(event) => { setOpenSwipeFlightId(null); setBalloon(event.target.value); }}><option value="all">Tous</option>{balloons.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
          <label><span>Durée</span><select value={duration} onChange={(event) => { setOpenSwipeFlightId(null); setDuration(event.target.value as DurationFilter); }}><option value="all">Toutes</option><option value="under-45">&lt; 45 min</option><option value="45-to-60">45–60 min</option><option value="over-60">&gt; 60 min</option></select></label>
          <label><span>Tri</span><select value={sortOrder} onChange={(event) => { setOpenSwipeFlightId(null); setSortOrder(event.target.value as SortOrder); }}><option value="recent">Plus récents</option><option value="oldest">Plus anciens</option><option value="duration">Durée la plus longue</option><option value="distance">Distance la plus longue</option></select></label>
          <button type="button" onClick={resetFilters} disabled={!filtersActive} className={styles.resetFilters}>Réinitialiser</button>
        </section>
      )}

      <section className={styles.flightList} aria-label="Liste des vols">
        {visibleFlights.length > 0 ? (
          visibleFlights.map((flight) => {
            const customTitle = demoState.customNames[flight.id] ?? flight.customTitle;
            const displayName = customTitle ?? getJournalFlightDisplayTitle(flight);
            return (
              <InteractiveFlightCard
                key={flight.id}
                flight={flight}
                displayName={displayName}
                customized={Boolean(customTitle)}
                menuOpen={menuFlightId === flight.id}
                swipeOpen={openSwipeFlightId === flight.id}
                onSetSwipeOpen={(open) => {
                  setOpenSwipeFlightId(open ? flight.id : null);
                  if (open) setMenuFlightId(null);
                }}
                onOpenMenu={(trigger) => {
                  setActionTrigger(trigger);
                  setOpenSwipeFlightId(null);
                  setMenuFlightId(flight.id);
                }}
                onCloseMenu={() => {
                  setMenuFlightId(null);
                  actionTrigger?.focus();
                }}
                onEdit={() => {
                  setPendingRename(flight);
                  setOpenSwipeFlightId(null);
                  setMenuFlightId(null);
                }}
                onDelete={() => {
                  setPendingDelete(flight);
                  setOpenSwipeFlightId(null);
                  setMenuFlightId(null);
                }}
              />
            );
          })
        ) : (
          <p className={styles.emptyState}>
            {query || filtersActive ? "Aucun vol trouvé" : "Aucun vol enregistré"}
          </p>
        )}
      </section>

      {pendingRename && (
        <RenameFlightDialog
          flight={pendingRename}
          initialName={demoState.customNames[pendingRename.id] ?? getJournalFlightDisplayTitle(pendingRename)}
          returnFocusTo={actionTrigger}
          onCancel={() => setPendingRename(null)}
          onConfirm={(name) => {
            if (completionState.journalFlights.some(({ id }) => id === pendingRename.id)) {
              persistJournalFlightCustomTitle(pendingRename.id, name);
            }
            const nextState = {
              ...demoState,
              customNames: { ...demoState.customNames, [pendingRename.id]: name },
            };
            saveJournalDemoState(nextState);
            setDemoState(nextState);
            setPendingRename(null);
          }}
          onRestoreAutomatic={() => {
            if (completionState.journalFlights.some(({ id }) => id === pendingRename.id)) {
              persistJournalFlightCustomTitle(pendingRename.id, null);
            }
            const customNames = { ...demoState.customNames };
            delete customNames[pendingRename.id];
            const nextState = { ...demoState, customNames };
            saveJournalDemoState(nextState);
            setDemoState(nextState);
            setPendingRename(null);
          }}
        />
      )}

      {pendingDelete && (
        <DeleteFlightDialog
          flightName={demoState.customNames[pendingDelete.id] ?? getJournalFlightDisplayTitle(pendingDelete)}
          linkedAscension={completionState.officialAscensions.some(({ sourceFlightId }) => sourceFlightId === pendingDelete.id)}
          returnFocusTo={actionTrigger}
          onCancel={() => setPendingDelete(null)}
          onConfirm={async (removeLinkedAscension = false) => {
            try {
              if (completionState.journalFlights.some(({ id }) => id === pendingDelete.id)) {
                await deleteRecordedJournalFlight(pendingDelete.id, removeLinkedAscension);
              }
            } catch {
              window.alert("Le vol et sa trace n’ont pas pu être supprimés.");
              return;
            }
            const nextState = {
              ...demoState,
              deletedFlightIds: [...new Set([...demoState.deletedFlightIds, pendingDelete.id])],
            };
            saveJournalDemoState(nextState);
            setDemoState(nextState);
            setPendingDelete(null);
            setToastVisible(true);
          }}
        />
      )}

      <p role="status" aria-live="polite" className={`${styles.toast} ${toastVisible ? styles.toastVisible : ""}`}>Vol supprimé</p>
      {!storageReady && <span className="sr-only">Chargement du journal</span>}
    </>
  );
}

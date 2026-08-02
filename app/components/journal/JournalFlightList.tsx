"use client";

import Link from "next/link";
import {
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Pencil, Search, SlidersHorizontal, Trash2 } from "lucide-react";
import { useFlightCompletionState } from "../../hooks/useFlightCompletionState";
import {
  loadJournalDemoState,
  saveJournalDemoState,
  type JournalDemoState,
} from "../../lib/journalDemoStorage";
import {
  getJournalFlightAutomaticName,
  type JournalFlight,
} from "../../lib/journalMockData";
import DeleteFlightDialog from "./DeleteFlightDialog";
import JournalTraceThumbnail from "./JournalTraceThumbnail";
import RenameFlightDialog from "./RenameFlightDialog";
import styles from "../../journal/Journal.module.css";
import { migrateCompletedRecordedFlightsToJournal } from "../../lib/flightCompletionStorage";
import { journalFlightsForMode } from "../../lib/realFlightJournal";

type JournalFlightListProps = { flights: readonly JournalFlight[] };
type DateFilter = "all" | "today" | "30-days" | "this-year" | "year" | "date";
type DurationFilter = "all" | "under-45" | "45-to-60" | "over-60";
type SortOrder = "recent" | "oldest" | "duration" | "distance";

const LONG_PRESS_MS = 500;
const MOVE_CANCEL_DISTANCE_PX = 9;
const EMPTY_STATE: JournalDemoState = {
  version: 2,
  deletedFlightIds: [],
  customNames: {},
};

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
  onRename: () => void;
  onDelete: () => void;
};

function FlightActionMenu({
  flightName,
  onClose,
  onRename,
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
      <button ref={firstActionRef} type="button" role="menuitem" onClick={onRename}>
        <Pencil size={16} aria-hidden="true" /> Renommer
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
  menuOpen: boolean;
  onOpenMenu: (trigger: HTMLElement) => void;
  onCloseMenu: () => void;
  onRename: () => void;
  onDelete: () => void;
};

function InteractiveFlightCard({
  flight,
  displayName,
  menuOpen,
  onOpenMenu,
  onCloseMenu,
  onRename,
  onDelete,
}: InteractiveFlightCardProps) {
  const linkRef = useRef<HTMLAnchorElement>(null);
  const timerRef = useRef<number | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const longPressTriggeredRef = useRef(false);

  const cancelLongPress = () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    startRef.current = null;
  };
  const beginLongPress = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    cancelLongPress();
    longPressTriggeredRef.current = false;
    startRef.current = { x: event.clientX, y: event.clientY };
    timerRef.current = window.setTimeout(() => {
      longPressTriggeredRef.current = true;
      if (linkRef.current) onOpenMenu(linkRef.current);
    }, LONG_PRESS_MS);
  };
  const trackMovement = (event: ReactPointerEvent<HTMLElement>) => {
    const start = startRef.current;
    if (!start) return;
    if (
      Math.hypot(event.clientX - start.x, event.clientY - start.y) >=
      MOVE_CANCEL_DISTANCE_PX
    ) {
      cancelLongPress();
    }
  };

  return (
    <article
      className={styles.flightCardShell}
      onPointerDown={beginLongPress}
      onPointerMove={trackMovement}
      onPointerUp={cancelLongPress}
      onPointerCancel={cancelLongPress}
      onContextMenu={(event) => {
        event.preventDefault();
        cancelLongPress();
        if (linkRef.current) onOpenMenu(linkRef.current);
      }}
    >
      <Link
        ref={linkRef}
        href={`/journal/${flight.id}`}
        className={`${styles.flightCard} ${menuOpen ? styles.flightCardSelected : ""}`}
        aria-label={`Ouvrir le vol ${displayName}`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={(event) => {
          if (longPressTriggeredRef.current || menuOpen) {
            event.preventDefault();
            longPressTriggeredRef.current = false;
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
            event.preventDefault();
            if (linkRef.current) onOpenMenu(linkRef.current);
          }
        }}
      >
        <div className="min-w-0">
          <p className={styles.flightDate}>{flight.date}</p>
          <h2 className={styles.flightRoute}>{displayName}</h2>
          <div className={styles.flightMetrics}>
            <span>{flight.durationMinutes} min</span>
            <span>{flight.distanceKm.toFixed(1)} km</span>
            {"logbookStatus" in flight && flight.logbookStatus === "PENDING" && (
              <span className={styles.pendingLogbook}>Carnet à valider</span>
            )}
          </div>
        </div>
        <div className={styles.thumbnail}>
          <JournalTraceThumbnail
            points={flight.points}
            label={`Miniature de la trace ${flight.departure} vers ${flight.arrival}`}
          />
        </div>
      </Link>
      {menuOpen && (
        <FlightActionMenu
          flightName={displayName}
          onClose={onCloseMenu}
          onRename={onRename}
          onDelete={onDelete}
        />
      )}
    </article>
  );
}

export default function JournalFlightList({ flights }: JournalFlightListProps) {
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
  const [pendingRename, setPendingRename] = useState<JournalFlight | null>(null);
  const [pendingDelete, setPendingDelete] = useState<JournalFlight | null>(null);
  const [actionTrigger, setActionTrigger] = useState<HTMLElement | null>(null);
  const [toastVisible, setToastVisible] = useState(false);
  const [demoEnabled, setDemoEnabled] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDemoEnabled(process.env.NODE_ENV === "development" && new URLSearchParams(window.location.search).get("demo") === "1");
      void migrateCompletedRecordedFlightsToJournal().catch((error: unknown) => {
        console.error("Migration non destructive des vols GPS impossible", error);
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const allFlights = useMemo(
    () => [
      ...journalFlightsForMode(completionState.journalFlights, demoEnabled),
      ...(demoEnabled ? flights : []).filter(
        (flight) => !completionState.journalFlights.some(({ id }) => id === flight.id),
      ),
    ],
    [completionState.journalFlights, demoEnabled, flights],
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
        demoState.customNames[flight.id] ?? getJournalFlightAutomaticName(flight);
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
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Rechercher un vol..."
            aria-label="Rechercher un vol"
            autoComplete="off"
          />
        </label>
        <button
          type="button"
          className={styles.filterButton}
          onClick={() => setFiltersOpen((current) => !current)}
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
          <label><span>Date</span><select value={dateFilter} onChange={(event) => setDateFilter(event.target.value as DateFilter)}><option value="all">Toutes</option><option value="today">Aujourd’hui</option><option value="30-days">30 derniers jours</option><option value="this-year">Cette année</option><option value="year">Choisir une année</option><option value="date">Choisir une date</option></select></label>
          {dateFilter === "year" && <label><span>Année</span><select value={selectedYear} onChange={(event) => setSelectedYear(event.target.value)}><option value="">Sélectionner</option>{years.map((year) => <option key={year} value={year}>{year}</option>)}</select></label>}
          {dateFilter === "date" && <label><span>Date précise</span><input type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} /></label>}
          <label><span>Terrain</span><select value={terrain} onChange={(event) => setTerrain(event.target.value)}><option value="all">Tous</option><optgroup label="Départ">{departureTerrains.map((value) => <option key={`departure-${value}`} value={`departure:${value}`}>{value}</option>)}</optgroup><optgroup label="Arrivée">{arrivalTerrains.map((value) => <option key={`arrival-${value}`} value={`arrival:${value}`}>{value}</option>)}</optgroup></select></label>
          <label><span>Ballon</span><select value={balloon} onChange={(event) => setBalloon(event.target.value)}><option value="all">Tous</option>{balloons.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
          <label><span>Durée</span><select value={duration} onChange={(event) => setDuration(event.target.value as DurationFilter)}><option value="all">Toutes</option><option value="under-45">&lt; 45 min</option><option value="45-to-60">45–60 min</option><option value="over-60">&gt; 60 min</option></select></label>
          <label><span>Tri</span><select value={sortOrder} onChange={(event) => setSortOrder(event.target.value as SortOrder)}><option value="recent">Plus récents</option><option value="oldest">Plus anciens</option><option value="duration">Durée la plus longue</option><option value="distance">Distance la plus longue</option></select></label>
          <button type="button" onClick={resetFilters} disabled={!filtersActive} className={styles.resetFilters}>Réinitialiser</button>
        </section>
      )}

      <section className={styles.flightList} aria-label="Liste des vols">
        {visibleFlights.length > 0 ? (
          visibleFlights.map((flight) => {
            const displayName =
              demoState.customNames[flight.id] ?? getJournalFlightAutomaticName(flight);
            return (
              <InteractiveFlightCard
                key={flight.id}
                flight={flight}
                displayName={displayName}
                menuOpen={menuFlightId === flight.id}
                onOpenMenu={(trigger) => {
                  setActionTrigger(trigger);
                  setMenuFlightId(flight.id);
                }}
                onCloseMenu={() => {
                  setMenuFlightId(null);
                  actionTrigger?.focus();
                }}
                onRename={() => {
                  setPendingRename(flight);
                  setMenuFlightId(null);
                }}
                onDelete={() => {
                  setPendingDelete(flight);
                  setMenuFlightId(null);
                }}
              />
            );
          })
        ) : (
          <p className={styles.emptyState}>
            {query || filtersActive ? "Aucun vol trouvé" : "Aucun vol dans le journal."}
          </p>
        )}
      </section>

      {pendingRename && (
        <RenameFlightDialog
          flight={pendingRename}
          initialName={demoState.customNames[pendingRename.id] ?? getJournalFlightAutomaticName(pendingRename)}
          returnFocusTo={actionTrigger}
          onCancel={() => setPendingRename(null)}
          onConfirm={(name) => {
            const nextState = {
              ...demoState,
              customNames: { ...demoState.customNames, [pendingRename.id]: name },
            };
            saveJournalDemoState(nextState);
            setDemoState(nextState);
            setPendingRename(null);
          }}
        />
      )}

      {pendingDelete && (
        <DeleteFlightDialog
          flightName={demoState.customNames[pendingDelete.id] ?? getJournalFlightAutomaticName(pendingDelete)}
          returnFocusTo={actionTrigger}
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => {
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

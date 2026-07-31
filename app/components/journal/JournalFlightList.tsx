"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import {
  loadDeletedDemoFlightIds,
  persistDeletedDemoFlightIds,
} from "../../lib/journalDemoStorage";
import type { JournalFlight } from "../../lib/journalMockData";
import DeleteFlightDialog from "./DeleteFlightDialog";
import JournalTraceThumbnail from "./JournalTraceThumbnail";
import styles from "../../journal/Journal.module.css";

type JournalFlightListProps = {
  flights: readonly JournalFlight[];
};

const ACTION_WIDTH = 82;
const REVEAL_THRESHOLD = 48;

type DragState = {
  pointerId: number;
  startX: number;
  startY: number;
  initialOffset: number;
  horizontal: boolean | null;
};

type SwipeFlightCardProps = {
  flight: JournalFlight;
  open: boolean;
  onOpen: (flightId: string | null) => void;
  onRequestDelete: (flight: JournalFlight, trigger: HTMLButtonElement) => void;
};

function SwipeFlightCard({
  flight,
  open,
  onOpen,
  onRequestDelete,
}: SwipeFlightCardProps) {
  const [dragOffset, setDragOffset] = useState<number | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const movedRef = useRef(false);

  const displayedOffset = dragOffset ?? (open ? -ACTION_WIDTH : 0);

  return (
    <article className={styles.swipeShell}>
      <button
        type="button"
        className={styles.deleteAction}
        tabIndex={open ? 0 : -1}
        aria-label={`Supprimer le vol ${flight.departure} vers ${flight.arrival}`}
        onClick={(event) => onRequestDelete(flight, event.currentTarget)}
      >
        <Trash2 size={21} aria-hidden="true" />
      </button>
      <div
        className={styles.swipeSurface}
        style={{ transform: `translateX(${displayedOffset}px)` }}
        onPointerDown={(event) => {
          if (event.pointerType === "mouse" && event.button !== 0) return;
          dragRef.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            initialOffset: open ? -ACTION_WIDTH : 0,
            horizontal: null,
          };
          movedRef.current = false;
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current;
          if (!drag || drag.pointerId !== event.pointerId) return;
          const deltaX = event.clientX - drag.startX;
          const deltaY = event.clientY - drag.startY;
          if (drag.horizontal === null && Math.max(Math.abs(deltaX), Math.abs(deltaY)) > 6) {
            drag.horizontal = Math.abs(deltaX) > Math.abs(deltaY);
          }
          if (!drag.horizontal) return;
          movedRef.current = true;
          setDragOffset(
            Math.max(-ACTION_WIDTH, Math.min(0, drag.initialOffset + deltaX)),
          );
        }}
        onPointerUp={(event) => {
          const drag = dragRef.current;
          if (!drag || drag.pointerId !== event.pointerId) return;
          const finalOffset = drag.horizontal
            ? Math.max(
                -ACTION_WIDTH,
                Math.min(0, drag.initialOffset + event.clientX - drag.startX),
              )
            : drag.initialOffset;
          const shouldOpen = finalOffset <= -REVEAL_THRESHOLD;
          onOpen(shouldOpen ? flight.id : null);
          setDragOffset(null);
          dragRef.current = null;
        }}
        onPointerCancel={() => {
          setDragOffset(null);
          dragRef.current = null;
        }}
      >
        <Link
          href={`/journal/${flight.id}`}
          className={styles.flightCard}
          aria-label={`Ouvrir le vol ${flight.departure} vers ${flight.arrival}`}
          onClick={(event) => {
            if (movedRef.current || open) event.preventDefault();
            if (open) onOpen(null);
            movedRef.current = false;
          }}
        >
          <div className="min-w-0">
            <p className={styles.flightDate}>{flight.date}</p>
            <h2 className={styles.flightRoute}>
              {flight.departure} → {flight.arrival}
            </h2>
            <div className={styles.flightMetrics}>
              <span>{flight.durationMinutes} min</span>
              <span>{flight.distanceKm.toFixed(1)} km</span>
            </div>
          </div>
          <div className={styles.thumbnail}>
            <JournalTraceThumbnail
              points={flight.points}
              label={`Miniature de la trace ${flight.departure} vers ${flight.arrival}`}
            />
          </div>
        </Link>
      </div>
    </article>
  );
}

export default function JournalFlightList({ flights }: JournalFlightListProps) {
  const [deletedIds, setDeletedIds] = useState<string[]>([]);
  const [storageReady, setStorageReady] = useState(false);
  const [openFlightId, setOpenFlightId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<JournalFlight | null>(null);
  const [deleteTrigger, setDeleteTrigger] = useState<HTMLElement | null>(null);
  const [toastVisible, setToastVisible] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDeletedIds(
        loadDeletedDemoFlightIds(flights.map((flight) => flight.id)),
      );
      setStorageReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [flights]);

  useEffect(() => {
    if (!toastVisible) return;
    const timer = window.setTimeout(() => setToastVisible(false), 2200);
    return () => window.clearTimeout(timer);
  }, [toastVisible]);

  const visibleFlights = storageReady
    ? flights.filter((flight) => !deletedIds.includes(flight.id))
    : flights;

  return (
    <>
      <section className={styles.flightList} aria-label="Liste des vols">
        {visibleFlights.length > 0 ? (
          visibleFlights.map((flight) => (
            <SwipeFlightCard
              key={flight.id}
              flight={flight}
              open={openFlightId === flight.id}
              onOpen={setOpenFlightId}
              onRequestDelete={(selectedFlight, trigger) => {
                setPendingDelete(selectedFlight);
                setDeleteTrigger(trigger);
              }}
            />
          ))
        ) : (
          <p className={styles.emptyState}>Aucun vol dans le journal.</p>
        )}
      </section>

      {pendingDelete && (
        <DeleteFlightDialog
          flight={pendingDelete}
          returnFocusTo={deleteTrigger}
          onCancel={() => {
            setPendingDelete(null);
            setOpenFlightId(null);
          }}
          onConfirm={() => {
            const nextIds = [...new Set([...deletedIds, pendingDelete.id])];
            persistDeletedDemoFlightIds(nextIds);
            setDeletedIds(nextIds);
            setPendingDelete(null);
            setOpenFlightId(null);
            setToastVisible(true);
          }}
        />
      )}

      <p
        role="status"
        aria-live="polite"
        className={`${styles.toast} ${toastVisible ? styles.toastVisible : ""}`}
      >
        Vol supprimé
      </p>
    </>
  );
}

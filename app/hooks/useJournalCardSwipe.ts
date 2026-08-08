"use client";

import {
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
} from "react";
import {
  JOURNAL_SWIPE_ACTIONS_WIDTH_PX,
  journalSwipeAxis,
  journalSwipeDestination,
  journalSwipeInitialOffset,
  journalSwipeOffset,
  type JournalSwipeAxis,
  type JournalSwipeStableState,
  type JournalSwipeState,
} from "../lib/journalSwipe";

export function useJournalCardSwipe({
  open,
  onSetOpen,
}: {
  open: boolean;
  onSetOpen: (open: boolean) => void;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const gestureRef = useRef<{
    startX: number;
    startY: number;
    lastX: number;
    lastAt: number;
    velocityX: number;
    initialOffsetX: number;
    initialState: JournalSwipeStableState;
    pointerId: number;
  } | null>(null);
  const axisRef = useRef<JournalSwipeAxis>(null);
  const phaseRef = useRef<JournalSwipeState>(open ? "open" : "closed");
  const offsetRef = useRef(open ? -JOURNAL_SWIPE_ACTIONS_WIDTH_PX : 0);
  const suppressClickRef = useRef(false);

  useEffect(() => {
    const offset = open ? -JOURNAL_SWIPE_ACTIONS_WIDTH_PX : 0;
    offsetRef.current = offset;
    phaseRef.current = open ? "open" : "closed";
    if (contentRef.current) {
      contentRef.current.style.transform = `translateX(${offset}px)`;
    }
  }, [open]);

  const settle = (destination: JournalSwipeStableState) => {
    const element = contentRef.current;
    const reducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    phaseRef.current = "settling";
    offsetRef.current = journalSwipeInitialOffset(destination);
    if (element) {
      element.style.transition = reducedMotion
        ? "none"
        : "transform 190ms cubic-bezier(0.22, 1, 0.36, 1)";
      element.style.transform = `translateX(${offsetRef.current}px)`;
    }
    onSetOpen(destination === "open");
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const initialState: JournalSwipeStableState = open ? "open" : "closed";
    const now = performance.now();
    gestureRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastAt: now,
      velocityX: 0,
      initialOffsetX: journalSwipeInitialOffset(initialState),
      initialState,
      pointerId: event.pointerId,
    };
    axisRef.current = null;
    suppressClickRef.current = false;
    if (!open) onSetOpen(false);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - gesture.startX;
    const deltaY = event.clientY - gesture.startY;
    axisRef.current ??= journalSwipeAxis(deltaX, deltaY);
    if (axisRef.current === "vertical") {
      if (gesture.initialState === "open") settle("closed");
      gestureRef.current = null;
      return;
    }
    if (axisRef.current !== "horizontal") return;
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    phaseRef.current = "dragging";
    suppressClickRef.current = true;
    event.currentTarget.style.transition = "none";
    const offset = journalSwipeOffset(deltaX, gesture.initialOffsetX);
    offsetRef.current = offset;
    event.currentTarget.style.transform = `translateX(${offset}px)`;
    const now = performance.now();
    gesture.velocityX =
      (event.clientX - gesture.lastX) / Math.max(1, now - gesture.lastAt);
    gesture.lastX = event.clientX;
    gesture.lastAt = now;
  };

  const finish = (
    event: ReactPointerEvent<HTMLDivElement>,
    cancelled = false,
  ) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (axisRef.current === "horizontal") {
      settle(
        journalSwipeDestination({
          initialState: gesture.initialState,
          deltaX: event.clientX - gesture.startX,
          velocityX: gesture.velocityX,
          cancelled,
        }),
      );
    } else if (cancelled) {
      settle(gesture.initialState);
    }
    gestureRef.current = null;
    axisRef.current = null;
  };

  return {
    contentRef,
    onPointerDown,
    onPointerMove,
    onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => finish(event),
    onPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) =>
      finish(event, true),
    onTransitionEnd: (propertyName: string, element: HTMLDivElement) => {
      if (propertyName !== "transform") return;
      element.style.transition = "none";
      phaseRef.current = open ? "open" : "closed";
    },
    onContentClick: (onOpen: () => void) => {
      if (suppressClickRef.current) {
        suppressClickRef.current = false;
        return;
      }
      if (open) settle("closed");
      else onOpen();
    },
  };
}

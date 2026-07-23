import { useEffect, useRef, useState } from "react";

export function useWakeLock(enabled: boolean): {
  active: boolean;
  supported: boolean;
} {
  const sentinelRef = useRef<WakeLockSentinel | null>(null);
  const [active, setActive] = useState(false);
  const supported =
    typeof navigator !== "undefined" && "wakeLock" in navigator;

  useEffect(() => {
    if (!enabled || !supported) {
      void sentinelRef.current?.release();
      sentinelRef.current = null;
      setActive(false);
      return;
    }

    let cancelled = false;
    const request = async () => {
      if (
        cancelled ||
        document.visibilityState !== "visible" ||
        sentinelRef.current
      ) {
        return;
      }
      try {
        const sentinel = await navigator.wakeLock.request("screen");
        if (cancelled) {
          await sentinel.release();
          return;
        }
        sentinelRef.current = sentinel;
        setActive(true);
        sentinel.addEventListener(
          "release",
          () => {
            if (sentinelRef.current === sentinel) {
              sentinelRef.current = null;
              setActive(false);
            }
          },
          { once: true },
        );
      } catch {
        setActive(false);
      }
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") void request();
    };
    void request();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      void sentinelRef.current?.release();
      sentinelRef.current = null;
    };
  }, [enabled, supported]);

  return { active, supported };
}

"use client";

import { useSyncExternalStore } from "react";
import {
  storageResilienceSnapshot,
  subscribeStorageResilience,
} from "../lib/storageResilience";

export function useStorageResilience() {
  return useSyncExternalStore(
    subscribeStorageResilience,
    storageResilienceSnapshot,
    storageResilienceSnapshot,
  );
}

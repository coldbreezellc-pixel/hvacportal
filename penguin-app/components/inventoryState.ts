"use client";
// Tiny shared state for "which group is open" so the Dashboard can deep-link
// into a group and the Inventory view remembers it across navigation.
import { useSyncExternalStore } from "react";

let activeGroup: string | null = null;
const listeners = new Set<() => void>();
const sub = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

export function setActiveGroup(g: string | null) {
  activeGroup = g;
  listeners.forEach((l) => l());
}

export function useActiveGroup() {
  return useSyncExternalStore(sub, () => activeGroup, () => null);
}

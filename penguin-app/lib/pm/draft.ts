"use client";
// One in-progress PM sheet per device, autosaved so a dropped phone or a
// closed browser never loses a half-finished PM. Expires after 24 h.
import { createStore, get, set, del } from "idb-keyval";
import type { PmFormState } from "./types";

const store = typeof indexedDB !== "undefined" ? createStore("penguin-maintenance", "kv") : undefined;
const KEY = "pm_draft";
const MAX_AGE = 24 * 60 * 60 * 1000;

export async function loadPmDraft(): Promise<PmFormState | null> {
  try {
    const d = await get<PmFormState>(KEY, store);
    if (!d || !d.savedAt) return null;
    if (Date.now() - new Date(d.savedAt).getTime() > MAX_AGE) { await del(KEY, store); return null; }
    return d;
  } catch { return null; }
}

export async function savePmDraft(d: PmFormState) {
  try { await set(KEY, d, store); } catch { /* quota / private mode */ }
}

export async function clearPmDraft() {
  try { await del(KEY, store); } catch { /* ignore */ }
}

/** Something worth resuming: more than the defaults. */
export const draftHasContent = (d: PmFormState) =>
  !!(d.facility || d.techNames.length || d.selectedEquip.length || d.generalComments || d.ppeAcknowledgedAt || d.photos.some((p) => p.dataUrl) || d.lotoPhotos.some((p) => p.dataUrl));

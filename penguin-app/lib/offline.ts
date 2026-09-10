// IndexedDB cache + outbox. Everything the UI needs to work with no service lives
// here, so the app opens instantly from cache and queued edits survive reloads.
import { createStore, get, set, del } from "idb-keyval";
import type { Item, ItemRow, LogRow, LogEntry, User } from "./types";

const store = typeof indexedDB !== "undefined" ? createStore("penguin-maintenance", "kv") : undefined;

export interface Cache {
  me: User | null;
  items: Item[];
  users: User[];
  logs: LogEntry[];
  savedAt: string | null;
}

export type Op =
  | { kind: "adjust"; id: string; delta: number; by: string }
  | { kind: "update"; id: string; patch: Partial<ItemRow>; by: string | null }
  | { kind: "insert"; row: ItemRow }
  | { kind: "delete"; id: string }
  | { kind: "log"; row: LogRow }
  | { kind: "photo"; id: string; thumb: string; full: string; by: string }
  | { kind: "email"; payload: EmailPayload };

export interface EmailPayload {
  to: string[];
  subject: string;
  text: string;
  attachments: { filename: string; content: string; contentType?: string }[];
}

export interface QueuedOp {
  opId: string;
  ts: string;
  attempts: number;
  op: Op;
}

const safe = async <T>(fn: () => Promise<T>, fallback: T): Promise<T> => {
  try { return await fn(); } catch { return fallback; }
};

export const loadCache = () =>
  safe<Cache | undefined>(() => get<Cache>("cache", store), undefined);

export const saveCache = (c: Cache) => safe(() => set("cache", c, store), undefined);

export const clearCache = () => safe(() => del("cache", store), undefined);

export const loadOutbox = () => safe<QueuedOp[]>(async () => (await get<QueuedOp[]>("outbox", store)) ?? [], []);

export const saveOutbox = (ops: QueuedOp[]) => safe(() => set("outbox", ops, store), undefined);

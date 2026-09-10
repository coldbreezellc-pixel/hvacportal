"use client";
// ─────────────────────────────────────────────────────────────────────────────
//  App store: one module-level state object the UI subscribes to.
//
//  • Boots from the IndexedDB cache first, so the app opens instantly even with
//    no service, then refreshes from Supabase in the background.
//  • Every edit is applied optimistically to local state AND appended to an
//    outbox. The outbox is flushed in order whenever we are online; if a request
//    fails for network reasons it is retried when the connection returns.
//  • Qty +/− are stored as deltas (rpc adjust_qty), so two crews editing the same
//    part offline both land correctly instead of one overwriting the other.
//  • Supabase Realtime pushes row changes from other phones; pending local ops
//    are re-applied on top of incoming rows so an in-flight edit never "flickers".
// ─────────────────────────────────────────────────────────────────────────────
import { useSyncExternalStore } from "react";
import type { RealtimeChannel, RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { getSupabase, supabaseConfigured } from "./supabase/client";
import {
  itemFromRow, itemToRow, logFromRow, patchToRow, userFromRow, uid, workOrderFromRow, visitFromRow,
  type Item, type ItemRow, type LogEntry, type LogRow, type Role, type User, type UserRow,
  type WorkOrder, type WorkOrderRow, type Visit, type VisitRow, type Photo,
} from "./types";
import { loadCache, saveCache, clearCache, loadOutbox, saveOutbox, type Op, type QueuedOp, type EmailPayload, type PendingPhoto } from "./offline";
import { dataUrlToBlob, type ResizedPhoto } from "./images";

export type View = "login" | "forgot" | "home" | "dashboard" | "inventory" | "workorders" | "users" | "logs" | "backups" | "profile";
export type Toast = { msg: string; type: "ok" | "err" } | null;

export interface State {
  ready: boolean;
  configured: boolean;
  online: boolean;
  me: User | null;
  items: Item[];
  users: User[];
  logs: LogEntry[];
  workOrders: WorkOrder[];
  pending: number;
  syncing: boolean;
  lastSync: string | null;
  toast: Toast;
  view: View;
}

const initial: State = {
  ready: false,
  configured: true,
  online: true,
  me: null,
  items: [],
  users: [],
  logs: [],
  workOrders: [],
  pending: 0,
  syncing: false,
  lastSync: null,
  toast: null,
  view: "login",
};

let state: State = initial;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const setState = (patch: Partial<State>) => { state = { ...state, ...patch }; emit(); };
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

export function useStore(): State {
  return useSyncExternalStore(subscribe, () => state, () => initial);
}

// ── Toast ───────────────────────────────────────────────────────────────────
let toastTimer: ReturnType<typeof setTimeout> | null = null;
export function flash(msg: string, type: "ok" | "err" = "ok") {
  setState({ toast: { msg, type } });
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => setState({ toast: null }), 3000);
}

export function setView(view: View) { setState({ view }); }

// ── Cache persistence ───────────────────────────────────────────────────────
let persistTimer: ReturnType<typeof setTimeout> | null = null;
function persistSoon() {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    void saveCache({ me: state.me, items: state.items, users: state.users, logs: state.logs, workOrders: state.workOrders, savedAt: new Date().toISOString() });
  }, 250);
}

// ── Outbox ──────────────────────────────────────────────────────────────────
let outbox: QueuedOp[] = [];
let flushing = false;
let flushAgain = false;

/** Does `op` touch the same item as `id` in a way that must stay ordered? */
const touchesItem = (op: Op, id: string) =>
  (op.kind === "update" || op.kind === "delete" || op.kind === "photo") ? op.id === id
  : op.kind === "insert" ? op.row.id === id
  : false;

async function enqueue(op: Op) {
  // Coalesce repeated +/− taps on the same item into one delta, as long as no
  // other edit to that item sits between them (log entries and other items don't matter).
  let merged = false;
  if (op.kind === "adjust") {
    for (let i = outbox.length - 1; i >= 0; i--) {
      const q = outbox[i];
      if (q.op.kind === "adjust" && q.op.id === op.id) {
        if (q.attempts === 0 && !(flushing && i === 0)) {
          q.op.delta += op.delta;
          q.op.by = op.by;
          if (q.op.delta === 0) outbox.splice(i, 1);
          merged = true;
        }
        break;
      }
      if (touchesItem(q.op, op.id)) break;
    }
  }
  if (!merged) outbox.push({ opId: uid(), ts: new Date().toISOString(), attempts: 0, op });
  setState({ pending: outbox.length });
  await saveOutbox(outbox);
  void flush();
}

const isNetworkError = (e: unknown) => {
  const msg = (e instanceof Error ? e.message : String(e ?? "")).toLowerCase();
  return !navigator.onLine || msg.includes("fetch") || msg.includes("network") || msg.includes("load failed") || msg.includes("timeout");
};

async function runOp(op: Op) {
  const sb = getSupabase();
  switch (op.kind) {
    case "adjust": {
      const { error } = await sb.rpc("adjust_qty", { p_id: op.id, p_delta: op.delta, p_by: op.by });
      if (error) throw error;
      return;
    }
    case "update": {
      const patch: Partial<ItemRow> = { ...op.patch };
      if (op.by) patch.updated_by = op.by;
      const { error } = await sb.from("inventory_items").update(patch).eq("id", op.id);
      if (error) throw error;
      return;
    }
    case "insert": {
      const { error } = await sb.from("inventory_items").upsert(op.row, { onConflict: "id" });
      if (error) throw error;
      return;
    }
    case "delete": {
      const { error } = await sb.from("inventory_items").delete().eq("id", op.id);
      if (error) throw error;
      return;
    }
    case "log": {
      const { error } = await sb.from("activity_logs").upsert(op.row, { onConflict: "id", ignoreDuplicates: true });
      if (error) throw error;
      return;
    }
    case "photo": {
      const stamp = Date.now();
      const base = `items/${op.id}/${stamp}`;
      const up = async (path: string, dataUrl: string) => {
        const { error } = await sb.storage.from("item-photos").upload(path, dataUrlToBlob(dataUrl), { contentType: "image/jpeg", upsert: true });
        if (error) throw error;
        return sb.storage.from("item-photos").getPublicUrl(path).data.publicUrl;
      };
      const [thumbUrl, fullUrl] = await Promise.all([up(`${base}-thumb.jpg`, op.thumb), up(`${base}-full.jpg`, op.full)]);
      const { error } = await sb.from("inventory_items")
        .update({ photo: thumbUrl, photo_full: fullUrl, photo_failed: false, updated_by: op.by })
        .eq("id", op.id);
      if (error) throw error;
      // swap the local data URLs for the hosted ones
      setState({ items: state.items.map((i) => (i.id === op.id ? { ...i, photo: thumbUrl, photoFull: fullUrl } : i)) });
      persistSoon();
      return;
    }
    case "email": {
      const res = await fetch("/api/email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(op.payload) });
      if (res.ok) { flash(`Report emailed to ${op.payload.to.join(", ")}`); return; }
      const j = await res.json().catch(() => ({}));
      const err = new Error(j.error || `Email failed (${res.status})`);
      if (res.status >= 400 && res.status < 500 || res.status === 503) { flash(err.message, "err"); throw Object.assign(err, { permanent: true }); }
      throw err;
    }
    case "wo_insert": {
      const photos = await uploadPhotos("wo-photos", `orders/${op.row.id}`, op.photos);
      const { error } = await sb.from("work_orders").upsert({ ...op.row, photos }, { onConflict: "id", ignoreDuplicates: true });
      if (error) throw error;
      swapUploadedPhotos(op.row.id, null, op.photos, photos);
      return;
    }
    case "wo_update": {
      const newPhotos = await uploadPhotos("wo-photos", `orders/${op.id}`, op.newPhotos);
      const { error } = await sb.rpc("update_work_order", { p_id: op.id, p_patch: op.patch, p_new_photos: newPhotos });
      if (error) throw error;
      swapUploadedPhotos(op.id, null, op.newPhotos, newPhotos);
      return;
    }
    case "wo_delete": {
      const { error } = await sb.from("work_orders").delete().eq("id", op.id);
      if (error) throw error;
      return;
    }
    case "visit_insert": {
      const photos = await uploadPhotos("wo-photos", `orders/${op.row.work_order_id}/visits/${op.row.id}`, op.photos);
      const { error } = await sb.from("work_order_visits").upsert({ ...op.row, photos }, { onConflict: "id", ignoreDuplicates: true });
      if (error) throw error;
      swapUploadedPhotos(op.row.work_order_id, op.row.id, op.photos, photos);
      return;
    }
    case "visit_delete": {
      const { error } = await sb.from("work_order_visits").delete().eq("id", op.id);
      if (error) throw error;
      return;
    }
  }
}

/** Upload device-only photos (data URLs) and return their public URLs. Already-hosted photos pass through. */
async function uploadPhotos(bucket: string, prefix: string, photos: PendingPhoto[]): Promise<Photo[]> {
  const sb = getSupabase();
  const out: Photo[] = [];
  for (const p of photos) {
    if (!p.thumb.startsWith("data:")) { out.push(p); continue; }
    const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const up = async (path: string, dataUrl: string) => {
      const { error } = await sb.storage.from(bucket).upload(path, dataUrlToBlob(dataUrl), { contentType: "image/jpeg", upsert: true });
      if (error) throw error;
      return sb.storage.from(bucket).getPublicUrl(path).data.publicUrl;
    };
    const [thumb, full] = await Promise.all([up(`${prefix}/${stamp}-thumb.jpg`, p.thumb), up(`${prefix}/${stamp}-full.jpg`, p.full)]);
    out.push({ thumb, full });
  }
  return out;
}

/** Replace local data-URL photos with the hosted URLs once uploaded. */
function swapUploadedPhotos(woId: string, visitId: string | null, local: PendingPhoto[], hosted: Photo[]) {
  if (!local.some((p) => p.thumb.startsWith("data:"))) return;
  const map = new Map(local.map((p, i) => [p.thumb, hosted[i]]));
  const swap = (list: Photo[]) => list.map((p) => map.get(p.thumb) ?? p);
  setState({
    workOrders: state.workOrders.map((w) => w.id !== woId ? w : visitId
      ? { ...w, visits: w.visits.map((v) => (v.id === visitId ? { ...v, photos: swap(v.photos) } : v)) }
      : { ...w, photos: swap(w.photos) }),
  });
  persistSoon();
}

/** Push queued ops to Supabase in order. Safe to call any time. */
export async function flush() {
  if (!supabaseConfigured() || !state.me) return;
  if (flushing) { flushAgain = true; return; }
  if (outbox.length === 0 || !navigator.onLine) return;
  flushing = true;
  setState({ syncing: true });
  let progressed = false;
  try {
    while (outbox.length > 0 && navigator.onLine) {
      const q = outbox[0];
      try {
        await runOp(q.op);
        outbox.shift();
        progressed = true;
      } catch (e) {
        if (isNetworkError(e)) break; // wait for connectivity
        q.attempts += 1;
        console.error("Sync op failed", q.op, e);
        const permanent = !!(e && typeof e === "object" && (e as { permanent?: boolean }).permanent);
        if (permanent || q.attempts >= 3) {
          // Permanent failure (RLS/validation) — drop it rather than block the queue.
          outbox.shift();
          flash("One change could not be saved to the server.", "err");
        } else {
          break;
        }
      }
      setState({ pending: outbox.length });
      await saveOutbox(outbox);
    }
  } finally {
    flushing = false;
    setState({ syncing: false, pending: outbox.length });
    await saveOutbox(outbox);
  }
  if (progressed && outbox.length === 0) {
    await refresh(); // reconcile with server truth once everything landed
  }
  if (flushAgain) { flushAgain = false; void flush(); }
}

/** Re-apply pending local ops for an item on top of a row that just arrived. */
function withPending(item: Item): Item {
  let out = item;
  for (const q of outbox) {
    const op = q.op;
    if (op.kind === "adjust" && op.id === item.id) out = { ...out, qty: Math.max(0, out.qty + op.delta) };
    if (op.kind === "update" && op.id === item.id) out = { ...out, ...rowPatchToItem(op.patch) };
    if (op.kind === "photo" && op.id === item.id) out = { ...out, photo: op.thumb, photoFull: op.full, photoFailed: false };
  }
  return out;
}

function rowPatchToItem(p: Partial<ItemRow>): Partial<Item> {
  const full = itemFromRow({ ...itemToRow(blankItem()), ...p } as ItemRow);
  const out: Partial<Item> = {};
  const inv: Record<string, keyof Item> = {
    group: "group", name: "name", part_number: "partNumber", qty: "qty", min_qty: "minQty", notes: "notes",
    location: "location", category: "category", photo: "photo", photo_full: "photoFull", photo_failed: "photoFailed", unit_id: "unitId",
    qty_units: "qtyUnits", qty_per_unit: "qtyPerUnit", total_needed: "totalNeeded", updated_by: "updatedBy",
  };
  for (const k of Object.keys(p)) {
    const key = inv[k];
    if (key) (out as Record<string, unknown>)[key] = full[key];
  }
  return out;
}

const blankItem = (): Item => ({
  id: "", group: "Misc", name: "", partNumber: "", qty: 0, minQty: 0, notes: "", location: "", category: "",
  photo: null, photoFull: null, photoFailed: false, unitId: null, qtyUnits: null, qtyPerUnit: null, totalNeeded: null,
  createdBy: null, updatedBy: null, createdAt: new Date().toISOString(), lastUpdated: new Date().toISOString(),
});

// ── Data loading ────────────────────────────────────────────────────────────
async function fetchProfile(userId: string): Promise<User | null> {
  const { data, error } = await getSupabase().from("users").select("*").eq("id", userId).maybeSingle();
  if (error || !data) return null;
  return userFromRow(data as UserRow);
}

export async function refresh() {
  if (!state.me || !navigator.onLine || !supabaseConfigured()) return;
  const sb = getSupabase();
  try {
    const [itemsRes, usersRes, woRes, visitRes] = await Promise.all([
      sb.from("inventory_items").select("*").order("group").order("name"),
      sb.from("users").select("*").order("display_name"),
      sb.from("work_orders").select("*").order("created_at", { ascending: false }),
      sb.from("work_order_visits").select("*").order("visit_date").order("logged_at"),
    ]);
    if (itemsRes.error) throw itemsRes.error;
    const items = (itemsRes.data as ItemRow[]).map(itemFromRow).map(withPending);
    const users = usersRes.error ? state.users : (usersRes.data as UserRow[]).map(userFromRow);
    let workOrders = state.workOrders;
    if (!woRes.error && !visitRes.error) {
      const visits = (visitRes.data as VisitRow[]).map(visitFromRow);
      workOrders = (woRes.data as WorkOrderRow[]).map((r) => withPendingWo(workOrderFromRow(r, visits.filter((v) => v.workOrderId === r.id))));
      // keep offline-created orders that haven't reached the server yet
      for (const local of state.workOrders) if (!workOrders.some((w) => w.id === local.id) && isPendingInsert(local.id)) workOrders.unshift(local);
    } else if (woRes.error) {
      console.error("work orders fetch failed", woRes.error.message);
    }
    let logs = state.logs;
    if (state.me.role === "admin") {
      const logRes = await sb.from("activity_logs").select("*").order("ts", { ascending: false }).limit(500);
      if (!logRes.error) logs = (logRes.data as LogRow[]).map(logFromRow);
    }
    const me = users.find((u) => u.id === state.me?.id) ?? state.me;
    setState({ items, users, logs, me, workOrders, lastSync: new Date().toISOString() });
    persistSoon();
  } catch (e) {
    if (!isNetworkError(e)) console.error("refresh failed", e);
  }
}

const isPendingInsert = (woId: string) => outbox.some((q) => q.op.kind === "wo_insert" && q.op.row.id === woId);

/** Re-apply queued edits/visits for a work order on top of a server row. */
function withPendingWo(wo: WorkOrder): WorkOrder {
  let out = wo;
  const local = state.workOrders.find((w) => w.id === wo.id);
  for (const q of outbox) {
    const op = q.op;
    if (op.kind === "wo_update" && op.id === wo.id) {
      const { photos, ...rest } = op.patch;
      out = { ...out, ...rest, photos: [...(photos ?? out.photos), ...op.newPhotos] };
    }
    if (op.kind === "visit_insert" && op.row.work_order_id === wo.id && !out.visits.some((v) => v.id === op.row.id)) {
      const lv = local?.visits.find((v) => v.id === op.row.id);
      if (lv) out = { ...out, visits: [...out.visits, lv] };
    }
    if (op.kind === "visit_delete" && op.workOrderId === wo.id) out = { ...out, visits: out.visits.filter((v) => v.id !== op.id) };
  }
  return out;
}

// ── Realtime ────────────────────────────────────────────────────────────────
let channel: RealtimeChannel | null = null;

function subscribeRealtime() {
  if (channel || !state.me || !supabaseConfigured()) return;
  const sb = getSupabase();
  channel = sb
    .channel("penguin-live")
    .on("postgres_changes", { event: "*", schema: "public", table: "inventory_items" }, (p: RealtimePostgresChangesPayload<ItemRow>) => {
      if (p.eventType === "DELETE") {
        const id = (p.old as Partial<ItemRow>).id;
        if (id) setState({ items: state.items.filter((i) => i.id !== id) });
      } else {
        const incoming = withPending(itemFromRow(p.new as ItemRow));
        const exists = state.items.some((i) => i.id === incoming.id);
        setState({ items: exists ? state.items.map((i) => (i.id === incoming.id ? incoming : i)) : [...state.items, incoming] });
      }
      persistSoon();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "users" }, (p: RealtimePostgresChangesPayload<UserRow>) => {
      if (p.eventType === "DELETE") {
        const id = (p.old as Partial<UserRow>).id;
        if (id) setState({ users: state.users.filter((u) => u.id !== id) });
      } else {
        const u = userFromRow(p.new as UserRow);
        const exists = state.users.some((x) => x.id === u.id);
        const users = exists ? state.users.map((x) => (x.id === u.id ? u : x)) : [...state.users, u];
        setState({ users, me: state.me && state.me.id === u.id ? u : state.me });
      }
      persistSoon();
    })
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "activity_logs" }, (p: RealtimePostgresChangesPayload<LogRow>) => {
      if (state.me?.role !== "admin") return;
      const entry = logFromRow(p.new as LogRow);
      if (state.logs.some((l) => l.id === entry.id)) return;
      setState({ logs: [entry, ...state.logs].slice(0, 500) });
      persistSoon();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "work_orders" }, (p: RealtimePostgresChangesPayload<WorkOrderRow>) => {
      if (p.eventType === "DELETE") {
        const id = (p.old as Partial<WorkOrderRow>).id;
        if (id) setState({ workOrders: state.workOrders.filter((w) => w.id !== id) });
      } else {
        const row = p.new as WorkOrderRow;
        const existing = state.workOrders.find((w) => w.id === row.id);
        const incoming = withPendingWo(workOrderFromRow(row, existing?.visits ?? []));
        setState({ workOrders: existing ? state.workOrders.map((w) => (w.id === row.id ? incoming : w)) : [incoming, ...state.workOrders] });
      }
      persistSoon();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "work_order_visits" }, (p: RealtimePostgresChangesPayload<VisitRow>) => {
      if (p.eventType === "DELETE") {
        const old = p.old as Partial<VisitRow>;
        setState({ workOrders: state.workOrders.map((w) => ({ ...w, visits: w.visits.filter((v) => v.id !== old.id) })) });
      } else {
        const v = visitFromRow(p.new as VisitRow);
        setState({ workOrders: state.workOrders.map((w) => w.id !== v.workOrderId ? w
          : { ...w, visits: w.visits.some((x) => x.id === v.id) ? w.visits.map((x) => (x.id === v.id ? v : x)) : [...w.visits, v] }) });
      }
      persistSoon();
    })
    .subscribe((status) => {
      // When the socket comes back after a drop we may have missed events.
      if (status === "SUBSCRIBED") void refresh();
    });
}

function unsubscribeRealtime() {
  if (channel) { void getSupabase().removeChannel(channel); channel = null; }
}

// ── Connectivity ────────────────────────────────────────────────────────────
let wired = false;
function wireConnectivity() {
  if (wired || typeof window === "undefined") return;
  wired = true;
  const onOnline = () => { setState({ online: true }); void flush().then(refresh); };
  const onOffline = () => setState({ online: false });
  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") void flush().then(refresh); });
  setInterval(() => { if (navigator.onLine) void flush(); }, 20000);
  setState({ online: navigator.onLine });
}

// ── Activity log ────────────────────────────────────────────────────────────
export function addLog(action: string, detail: string, userName?: string | null) {
  const row: LogRow = {
    id: uid(), action, detail,
    user_name: userName || state.me?.displayName || "System",
    user_id: state.me?.id ?? null,
    ts: new Date().toISOString(),
  };
  if (state.me?.role === "admin") {
    setState({ logs: [logFromRow(row), ...state.logs].slice(0, 500) });
    persistSoon();
  }
  void enqueue({ kind: "log", row });
}

// ── Boot ────────────────────────────────────────────────────────────────────
export async function init() {
  if (typeof window === "undefined") return;
  wireConnectivity();
  outbox = await loadOutbox();
  const cache = await loadCache();
  const configured = supabaseConfigured();
  if (cache) {
    setState({ items: cache.items ?? [], users: cache.users ?? [], logs: cache.logs ?? [], workOrders: cache.workOrders ?? [], pending: outbox.length });
  }
  if (!configured) { setState({ ready: true, configured: false }); return; }

  let me: User | null = null;
  try {
    const { data: { session } } = await getSupabase().auth.getSession();
    if (session) {
      if (navigator.onLine) me = await fetchProfile(session.user.id);
      if (!me && cache?.me && cache.me.id === session.user.id) me = cache.me; // offline start, or server briefly unreachable
    }
  } catch {
    if (cache?.me) me = cache.me;
  }

  if (me) {
    setState({ me, view: initialView(me), ready: true });
    subscribeRealtime();
    await flush();
    await refresh();
  } else {
    setState({ me: null, view: "login", ready: true });
  }
}

function initialView(me: User): View {
  const params = new URLSearchParams(window.location.search);
  const urlView = params.get("view") as View | null;
  const allowed: View[] = ["home", "dashboard", "inventory", "workorders", "users", "logs", "backups", "profile"];
  const isAdmin = me.role === "admin";
  let v: View = me.mustResetPw ? "profile" : "home";
  if (urlView && allowed.includes(urlView)) {
    if ((urlView === "users" || urlView === "logs" || urlView === "backups") && !isAdmin) v = "dashboard";
    else v = urlView;
  }
  return v;
}

// ── Auth ────────────────────────────────────────────────────────────────────
export async function login(username: string, password: string): Promise<boolean> {
  if (!navigator.onLine) { flash("You're offline — sign in needs a connection.", "err"); return false; }
  const sb = getSupabase();
  let email = username.trim();
  if (!email.includes("@")) {
    const { data } = await sb.rpc("email_for_username", { p_username: email });
    if (!data) { flash("Invalid username or password.", "err"); return false; }
    email = data as string;
  }
  const { data, error } = await sb.auth.signInWithPassword({ email, password: password.trim() });
  if (error || !data.user) { flash("Invalid username or password.", "err"); return false; }
  const me = await fetchProfile(data.user.id);
  if (!me) { flash("Your account has no profile — ask an admin.", "err"); await sb.auth.signOut(); return false; }
  setState({ me, view: me.mustResetPw ? "profile" : "home" });
  persistSoon();
  subscribeRealtime();
  addLog("Login", `${me.displayName} signed in`, me.displayName);
  flash(`Welcome back, ${me.displayName}`);
  await flush();
  await refresh();
  return true;
}

export async function logout(opts: { silent?: boolean } = {}) {
  const me = state.me;
  if (!me) return;
  if (outbox.length > 0 && navigator.onLine) await flush();
  if (outbox.length > 0 && !opts.silent) {
    const ok = window.confirm(`${outbox.length} change(s) haven't reached the server yet. They'll upload after your next sign-in. Sign out anyway?`);
    if (!ok) return;
  }
  addLog("Logout", `${me.displayName} signed out`, me.displayName);
  if (navigator.onLine) await flush();
  unsubscribeRealtime();
  try { await getSupabase().auth.signOut(); } catch { /* offline — local session is still cleared */ }
  await clearCache();
  setState({ me: null, view: "login", items: [], users: [], logs: [], workOrders: [] });
}

export async function forgotPassword(username: string): Promise<string | null> {
  const sb = getSupabase();
  let email = username.trim();
  if (!email.includes("@")) {
    const { data } = await sb.rpc("email_for_username", { p_username: email });
    if (!data) return null;
    email = data as string;
  }
  const { error } = await sb.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/auth/confirm?next=/reset-password`,
  });
  if (error) { flash(error.message, "err"); return null; }
  return email;
}

export async function changeOwnPassword(newPw: string): Promise<boolean> {
  const me = state.me;
  if (!me) return false;
  if (!navigator.onLine) { flash("Changing your password needs a connection.", "err"); return false; }
  const sb = getSupabase();
  const { error } = await sb.auth.updateUser({ password: newPw.trim() });
  if (error) { flash(error.message, "err"); return false; }
  await sb.rpc("clear_must_reset_pw");
  const updated = { ...me, mustResetPw: false };
  setState({ me: updated, users: state.users.map((u) => (u.id === me.id ? updated : u)), view: "dashboard" });
  persistSoon();
  addLog("Password Changed", `${me.displayName} changed their password`, me.displayName);
  flash("Password changed.");
  return true;
}

// ── Inventory ───────────────────────────────────────────────────────────────
const now = () => new Date().toISOString();

export function addItem(data: Partial<Item>, activeGroup: string) {
  const me = state.me!;
  const item: Item = {
    ...blankItem(), ...data,
    group: data.group || activeGroup,
    id: uid(),
    createdBy: me.displayName, updatedBy: me.displayName,
    createdAt: now(), lastUpdated: now(),
  };
  setState({ items: [...state.items, item] });
  persistSoon();
  void enqueue({ kind: "insert", row: itemToRow(item) });
  addLog("Item Added", `Added "${item.name}" to ${item.group} (qty: ${item.qty})`, me.displayName);
  flash(`"${item.name}" added.`);
}

export function updateItem(id: string, data: Partial<Item>, opts: { log?: boolean; toast?: boolean } = {}) {
  const me = state.me!;
  const old = state.items.find((i) => i.id === id);
  const shouldLog = opts.log ?? true;
  const patch: Partial<Item> = { ...data };
  if (shouldLog) { patch.lastUpdated = now(); patch.updatedBy = me.displayName; }
  setState({ items: state.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) });
  persistSoon();
  const rowPatch = patchToRow(data);
  delete rowPatch.id; delete rowPatch.created_at; delete rowPatch.updated_at;
  void enqueue({ kind: "update", id, patch: rowPatch, by: shouldLog ? me.displayName : null });
  if (shouldLog) {
    const changes: string[] = [];
    if (data.name && data.name !== old?.name) changes.push(`name: "${old?.name}" → "${data.name}"`);
    if (data.notes !== undefined && data.notes !== old?.notes) changes.push("description updated");
    if (data.qty !== undefined && data.qty !== old?.qty) changes.push(`qty: ${old?.qty} → ${data.qty}`);
    addLog("Item Updated", `Updated "${old?.name || id}"${changes.length ? " — " + changes.join(", ") : ""}`, me.displayName);
    if (opts.toast ?? true) flash("Item updated.");
  }
}

export function deleteItem(id: string) {
  const me = state.me!;
  const target = state.items.find((i) => i.id === id);
  setState({ items: state.items.filter((i) => i.id !== id) });
  persistSoon();
  void enqueue({ kind: "delete", id });
  addLog("Item Deleted", `Deleted "${target?.name || id}" from ${target?.group || "unknown"}`, me.displayName);
  flash("Item removed.");
}

export function adjustQty(id: string, delta: number) {
  const me = state.me!;
  const old = state.items.find((i) => i.id === id);
  if (!old) return;
  const nq = Math.max(0, old.qty + delta);
  setState({ items: state.items.map((i) => (i.id === id ? { ...i, qty: nq, lastUpdated: now(), updatedBy: me.displayName } : i)) });
  persistSoon();
  void enqueue({ kind: "adjust", id, delta: nq - old.qty, by: me.displayName });
  addLog("Qty Changed", `"${old.name}" qty: ${old.qty} → ${nq}`, me.displayName);
}

export function resetStock(ids: Set<string>, group: string) {
  const me = state.me!;
  setState({ items: state.items.map((i) => (ids.has(i.id) ? { ...i, qty: 0, lastUpdated: now(), updatedBy: me.displayName } : i)) });
  persistSoon();
  ids.forEach((id) => void enqueue({ kind: "update", id, patch: { qty: 0 }, by: me.displayName }));
  addLog("Stock Reset", `Reset ${ids.size} items to 0 in ${group}`, me.displayName);
}

export function batchUpdatePhotos(updates: Record<string, Partial<Item>>) {
  setState({ items: state.items.map((i) => (updates[i.id] ? { ...i, ...updates[i.id] } : i)) });
  persistSoon();
  for (const [id, patch] of Object.entries(updates)) {
    void enqueue({ kind: "update", id, patch: patchToRow(patch), by: null });
  }
}

// ── Users (admin — goes through server routes that hold the service key) ───
async function adminFetch(path: string, method: string, body?: unknown) {
  if (!navigator.onLine) throw new Error("User management needs a connection.");
  const res = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json;
}

export async function createUser(data: { username: string; displayName: string; email: string; role: Role; password: string }) {
  const me = state.me!;
  try {
    const { user } = await adminFetch("/api/admin/users", "POST", data);
    const u = userFromRow(user as UserRow);
    if (!state.users.some((x) => x.id === u.id)) setState({ users: [...state.users, u] });
    persistSoon();
    addLog("User Created", `Created user "${data.username}" (${data.role})`, me.displayName);
    flash(`User "${data.username}" created.`);
    return u;
  } catch (e) {
    flash(e instanceof Error ? e.message : "Could not create user.", "err");
    return null;
  }
}

export async function updateUser(id: string, data: Partial<Pick<User, "displayName" | "email" | "role" | "username">>) {
  const me = state.me!;
  const target = state.users.find((u) => u.id === id);
  try {
    const { user } = await adminFetch(`/api/admin/users/${id}`, "PATCH", data);
    const u = userFromRow(user as UserRow);
    setState({ users: state.users.map((x) => (x.id === id ? u : x)), me: state.me?.id === id ? u : state.me });
    persistSoon();
    addLog("User Updated", `Updated user "${target?.displayName || id}"`, me.displayName);
    flash("User updated.");
  } catch (e) {
    flash(e instanceof Error ? e.message : "Could not update user.", "err");
  }
}

export async function deleteUser(id: string) {
  const me = state.me!;
  const target = state.users.find((u) => u.id === id);
  try {
    await adminFetch(`/api/admin/users/${id}`, "DELETE");
    setState({ users: state.users.filter((u) => u.id !== id) });
    persistSoon();
    addLog("User Deleted", `Deleted user "${target?.displayName || id}"`, me.displayName);
    flash("User deleted.");
  } catch (e) {
    flash(e instanceof Error ? e.message : "Could not delete user.", "err");
  }
}

export async function resetPassword(id: string, newPw: string) {
  const me = state.me!;
  const target = state.users.find((u) => u.id === id);
  try {
    await adminFetch(`/api/admin/users/${id}/reset-password`, "POST", { password: newPw });
    setState({ users: state.users.map((u) => (u.id === id ? { ...u, mustResetPw: true } : u)) });
    persistSoon();
    addLog("Password Reset", `Reset password for "${target?.displayName || id}"`, me.displayName);
    flash("Password reset. User must change on next login.");
  } catch (e) {
    flash(e instanceof Error ? e.message : "Could not reset password.", "err");
  }
}

// ── Photos ──────────────────────────────────────────────────────────────────
export function setItemPhoto(id: string, photo: ResizedPhoto) {
  const me = state.me!;
  const target = state.items.find((i) => i.id === id);
  setState({ items: state.items.map((i) => (i.id === id ? { ...i, photo: photo.thumb, photoFull: photo.full, photoFailed: false, lastUpdated: now(), updatedBy: me.displayName } : i)) });
  persistSoon();
  void enqueue({ kind: "photo", id, thumb: photo.thumb, full: photo.full, by: me.displayName });
  addLog("Item Updated", `Photo ${target?.photo ? "replaced" : "added"} for "${target?.name || id}"`, me.displayName);
  flash(navigator.onLine ? "Photo saved." : "Photo saved — uploads when you're back online.");
}

export function removeItemPhoto(id: string) {
  const me = state.me!;
  const target = state.items.find((i) => i.id === id);
  setState({ items: state.items.map((i) => (i.id === id ? { ...i, photo: null, photoFull: null, lastUpdated: now(), updatedBy: me.displayName } : i)) });
  persistSoon();
  void enqueue({ kind: "update", id, patch: { photo: null, photo_full: null }, by: me.displayName });
  addLog("Item Updated", `Photo removed from "${target?.name || id}"`, me.displayName);
}

// ── Email (queued like everything else, so it goes out when service returns) ─
export function sendEmail(payload: EmailPayload) {
  void enqueue({ kind: "email", payload });
  flash(navigator.onLine ? "Sending report…" : "Report queued — it will send when you're back online.");
}

// ── Work orders ─────────────────────────────────────────────────────────────
export interface WorkOrderInput { title: string; location: string; type: string; priority: string; status: string; details: string }

export function createWorkOrder(data: WorkOrderInput, photos: PendingPhoto[]) {
  const me = state.me!;
  const id = (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : uid());
  const ts = now();
  const wo: WorkOrder = {
    id, woNumber: null, ...data, photos, createdBy: me.displayName, source: null, createdAt: ts, updatedAt: ts, visits: [],
  };
  setState({ workOrders: [wo, ...state.workOrders] });
  persistSoon();
  void enqueue({ kind: "wo_insert", row: { id, wo_number: null, ...data, created_by: me.displayName, source: null, created_at: ts }, photos });
  addLog("WO Created", `Created work order "${data.title}" (${data.location}, ${data.priority})`, me.displayName);
  flash(navigator.onLine ? "Work order created." : "Work order saved — it gets its number when you're back online.");
  return wo;
}

export function updateWorkOrder(id: string, patch: Partial<WorkOrderInput>, newPhotos: PendingPhoto[] = []) {
  const me = state.me!;
  const old = state.workOrders.find((w) => w.id === id);
  setState({ workOrders: state.workOrders.map((w) => (w.id === id ? { ...w, ...patch, photos: [...w.photos, ...newPhotos], updatedAt: now() } : w)) });
  persistSoon();
  void enqueue({ kind: "wo_update", id, patch, newPhotos });
  const changes: string[] = [];
  if (patch.status && patch.status !== old?.status) changes.push(`status: ${old?.status} → ${patch.status}`);
  if (patch.title && patch.title !== old?.title) changes.push("title changed");
  if (newPhotos.length) changes.push(`${newPhotos.length} photo(s) added`);
  addLog("WO Updated", `${old?.woNumber || "Work order"} "${patch.title ?? old?.title ?? ""}"${changes.length ? " — " + changes.join(", ") : ""}`, me.displayName);
  flash("Work order updated.");
}

export function setWorkOrderStatus(id: string, status: string) {
  updateWorkOrder(id, { status });
}

export function removeWorkOrderPhoto(id: string, index: number) {
  const wo = state.workOrders.find((w) => w.id === id);
  if (!wo) return;
  const photos = wo.photos.filter((_, i) => i !== index);
  setState({ workOrders: state.workOrders.map((w) => (w.id === id ? { ...w, photos } : w)) });
  persistSoon();
  void enqueue({ kind: "wo_update", id, patch: { photos: photos.filter((p) => !p.thumb.startsWith("data:")) }, newPhotos: photos.filter((p) => p.thumb.startsWith("data:")) });
}

export function deleteWorkOrder(id: string) {
  const me = state.me!;
  const wo = state.workOrders.find((w) => w.id === id);
  setState({ workOrders: state.workOrders.filter((w) => w.id !== id) });
  persistSoon();
  void enqueue({ kind: "wo_delete", id });
  addLog("WO Deleted", `Deleted ${wo?.woNumber || "work order"} "${wo?.title || ""}"`, me.displayName);
  flash("Work order deleted.");
}

export interface VisitInput { date: string; tech: string; hours: number; notes: string }

export function addVisit(workOrderId: string, data: VisitInput, photos: PendingPhoto[]) {
  const me = state.me!;
  const id = (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : uid());
  const visit: Visit = { id, workOrderId, ...data, photos, loggedBy: me.displayName, loggedAt: now() };
  const wo = state.workOrders.find((w) => w.id === workOrderId);
  setState({ workOrders: state.workOrders.map((w) => (w.id === workOrderId ? { ...w, visits: [...w.visits, visit] } : w)) });
  persistSoon();
  void enqueue({ kind: "visit_insert", row: { id, work_order_id: workOrderId, visit_date: data.date, tech: data.tech, hours: data.hours, notes: data.notes, logged_by: me.displayName, logged_at: visit.loggedAt }, photos });
  addLog("Visit Logged", `${wo?.woNumber || "Work order"}: ${data.tech || me.displayName} logged ${data.hours} h on ${data.date}`, me.displayName);
  flash("Visit added.");
}

export function deleteVisit(workOrderId: string, visitId: string) {
  const me = state.me!;
  const wo = state.workOrders.find((w) => w.id === workOrderId);
  setState({ workOrders: state.workOrders.map((w) => (w.id === workOrderId ? { ...w, visits: w.visits.filter((v) => v.id !== visitId) } : w)) });
  persistSoon();
  void enqueue({ kind: "visit_delete", id: visitId, workOrderId });
  addLog("WO Updated", `${wo?.woNumber || "Work order"}: visit removed`, me.displayName);
}

// ── Backups (admin) ─────────────────────────────────────────────────────────
export interface BackupMeta { id: number; taken_at: string; kind: string; note: string | null; item_count: number; user_count: number; log_count: number }

export async function listBackups(): Promise<BackupMeta[]> {
  const { data, error } = await getSupabase().from("backups")
    .select("id, taken_at, kind, note, item_count, user_count, log_count")
    .order("taken_at", { ascending: false }).limit(200);
  if (error) { flash(error.message, "err"); return []; }
  return (data ?? []) as BackupMeta[];
}

export async function takeBackupNow(note?: string): Promise<boolean> {
  const { error } = await getSupabase().rpc("take_backup", { p_kind: "manual", p_note: note ?? `Manual backup by ${state.me?.displayName ?? "admin"}` });
  if (error) { flash(error.message, "err"); return false; }
  addLog("Backup Taken", `Manual backup taken`, state.me?.displayName);
  flash("Backup saved.");
  return true;
}

export async function restoreBackup(id: number): Promise<boolean> {
  const { error } = await getSupabase().rpc("restore_backup", { p_id: id });
  if (error) { flash(error.message, "err"); return false; }
  flash(`Restored from backup #${id}.`);
  await refresh();
  return true;
}

export async function fetchBackup(id: number): Promise<Record<string, unknown> | null> {
  const { data, error } = await getSupabase().from("backups").select("*").eq("id", id).single();
  if (error) { flash(error.message, "err"); return null; }
  return data as Record<string, unknown>;
}

export const getOutboxSize = () => outbox.length;

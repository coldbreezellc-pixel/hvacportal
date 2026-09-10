export type Role = "admin" | "crew";

export interface User {
  id: string;
  username: string;
  displayName: string;
  email: string;
  role: Role;
  mustResetPw: boolean;
  createdAt: string;
}

export interface Item {
  id: string;
  group: string;
  name: string;
  partNumber: string;
  qty: number;
  minQty: number;
  notes: string;
  location: string;
  category: string;
  photo: string | null;
  photoFull: string | null;
  photoFailed: boolean;
  unitId: string | null;
  qtyUnits: number | null;
  qtyPerUnit: string | null;
  totalNeeded: number | null;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  lastUpdated: string;
}

// ── Work orders ──
export const WO_STATUSES = ["Open", "In Progress", "On Hold", "Completed"] as const;
export type WoStatus = (typeof WO_STATUSES)[number];
export const WO_LOCATIONS = ["900 Sylvan Ave", "904 Sylvan Ave", "Other"];
export const WO_TYPES = ["Cold Call", "Repair", "Preventive Maintenance", "Installation", "Inspection", "Emergency", "Other"];
export const WO_PRIORITIES = ["Normal", "High", "Urgent", "Low"];

export interface Photo { thumb: string; full: string }

export interface Visit {
  id: string;
  workOrderId: string;
  date: string;       // YYYY-MM-DD
  tech: string;
  hours: number;
  notes: string;
  photos: Photo[];
  loggedBy: string | null;
  loggedAt: string;
}

export interface WorkOrder {
  id: string;
  woNumber: string | null;   // null until the server assigns it (offline-created)
  title: string;
  location: string;
  type: string;
  priority: string;
  status: WoStatus | string;
  details: string;
  photos: Photo[];
  createdBy: string | null;
  source: string | null;
  createdAt: string;
  updatedAt: string;
  visits: Visit[];
}

export interface WorkOrderRow {
  id: string; wo_number: string | null; title: string; location: string; type: string; priority: string; status: string;
  details: string; photos: Photo[] | string[]; created_by: string | null; source: string | null;
  slack_channel?: string | null; slack_ts?: string | null; created_at: string; updated_at: string;
}
export interface VisitRow {
  id: string; work_order_id: string; visit_date: string; tech: string; hours: number | string; notes: string;
  photos: Photo[] | string[]; logged_by: string | null; logged_at: string;
}

export const normPhotos = (p: unknown): Photo[] =>
  Array.isArray(p) ? p.map((x) => (typeof x === "string" ? { thumb: x, full: x } : x as Photo)).filter((x) => x && x.thumb) : [];

export const visitFromRow = (r: VisitRow): Visit => ({
  id: r.id, workOrderId: r.work_order_id, date: r.visit_date, tech: r.tech ?? "", hours: Number(r.hours) || 0,
  notes: r.notes ?? "", photos: normPhotos(r.photos), loggedBy: r.logged_by ?? null, loggedAt: r.logged_at,
});

export const workOrderFromRow = (r: WorkOrderRow, visits: Visit[] = []): WorkOrder => ({
  id: r.id, woNumber: r.wo_number ?? null, title: r.title, location: r.location, type: r.type, priority: r.priority,
  status: r.status, details: r.details ?? "", photos: normPhotos(r.photos), createdBy: r.created_by ?? null,
  source: r.source ?? null, createdAt: r.created_at, updatedAt: r.updated_at, visits,
});

export interface LogEntry {
  id: string;
  action: string;
  detail: string;
  user: string;
  ts: string;
}

// ── Database row shapes (snake_case, as stored in Postgres) ──
export interface UserRow {
  id: string;
  username: string;
  display_name: string;
  email: string;
  role: Role;
  must_reset_pw: boolean;
  created_at: string;
  updated_at?: string;
}

export interface ItemRow {
  id: string;
  group: string;
  name: string;
  part_number: string;
  qty: number;
  min_qty: number;
  notes: string;
  location: string;
  category: string;
  photo: string | null;
  photo_full: string | null;
  photo_failed: boolean;
  unit_id: string | null;
  qty_units: number | null;
  qty_per_unit: string | null;
  total_needed: number | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface LogRow {
  id: string;
  action: string;
  detail: string;
  user_name: string;
  user_id: string | null;
  ts: string;
}

export const userFromRow = (r: UserRow): User => ({
  id: r.id,
  username: r.username,
  displayName: r.display_name,
  email: r.email,
  role: r.role,
  mustResetPw: !!r.must_reset_pw,
  createdAt: r.created_at,
});

export const itemFromRow = (r: ItemRow): Item => ({
  id: r.id,
  group: r.group,
  name: r.name,
  partNumber: r.part_number ?? "",
  qty: r.qty ?? 0,
  minQty: r.min_qty ?? 0,
  notes: r.notes ?? "",
  location: r.location ?? "",
  category: r.category ?? "",
  photo: r.photo ?? null,
  photoFull: r.photo_full ?? null,
  photoFailed: !!r.photo_failed,
  unitId: r.unit_id ?? null,
  qtyUnits: r.qty_units ?? null,
  qtyPerUnit: r.qty_per_unit ?? null,
  totalNeeded: r.total_needed ?? null,
  createdBy: r.created_by ?? null,
  updatedBy: r.updated_by ?? null,
  createdAt: r.created_at,
  lastUpdated: r.updated_at,
});

export const itemToRow = (i: Item): ItemRow => ({
  id: i.id,
  group: i.group,
  name: i.name,
  part_number: i.partNumber ?? "",
  qty: i.qty ?? 0,
  min_qty: i.minQty ?? 0,
  notes: i.notes ?? "",
  location: i.location ?? "",
  category: i.category ?? "",
  photo: i.photo ?? null,
  photo_full: i.photoFull ?? null,
  photo_failed: !!i.photoFailed,
  unit_id: i.unitId ?? null,
  qty_units: i.qtyUnits ?? null,
  qty_per_unit: i.qtyPerUnit ?? null,
  total_needed: i.totalNeeded ?? null,
  created_by: i.createdBy ?? null,
  updated_by: i.updatedBy ?? null,
  created_at: i.createdAt,
  updated_at: i.lastUpdated,
});

/** Camel-case item patch → snake-case row patch. Unknown keys are dropped. */
export const patchToRow = (p: Partial<Item>): Partial<ItemRow> => {
  const map: Record<keyof Item, keyof ItemRow> = {
    id: "id", group: "group", name: "name", partNumber: "part_number", qty: "qty", minQty: "min_qty",
    notes: "notes", location: "location", category: "category", photo: "photo", photoFull: "photo_full", photoFailed: "photo_failed",
    unitId: "unit_id", qtyUnits: "qty_units", qtyPerUnit: "qty_per_unit", totalNeeded: "total_needed",
    createdBy: "created_by", updatedBy: "updated_by", createdAt: "created_at", lastUpdated: "updated_at",
  };
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(p)) {
    const col = map[k as keyof Item];
    if (col && v !== undefined) out[col] = v;
  }
  return out as Partial<ItemRow>;
};

export const logFromRow = (r: LogRow): LogEntry => ({
  id: r.id,
  action: r.action,
  detail: r.detail,
  user: r.user_name,
  ts: r.ts,
});

export const INVENTORY_GROUPS = [
  "Plumbing", "Faucet Parts", "Air Filters 900", "Air Filters 904", "Electrical", "HVAC",
  "Lighting", "Hardware", "Safety", "Tools", "AV/Tech", "Misc",
];

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

#!/usr/bin/env node
// Imports the CURRENT live inventory and activity log from the old portal's JSON
// files (data/pm_inventory.json, data/pm_logs.json in this repo — the files the
// Railway app writes through GitHub) into Supabase, keeping real stock counts,
// photos and notes. Upserts by id, so it can be re-run.
//
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/import-live.mjs \
//       [--inventory ../data/pm_inventory.json] [--logs ../data/pm_logs.json] [--overwrite]
//
// Without --overwrite, items that already exist in Supabase are left alone (so a
// seed.sql run followed by import-live only fills the gaps). With --overwrite the
// live JSON wins for every id it contains.
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : dflt; };
const overwrite = args.includes("--overwrite");

const invFile = path.resolve(here, opt("--inventory", "../../data/pm_inventory.json"));
const logFile = path.resolve(here, opt("--logs", "../../data/pm_logs.json"));
const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

const toInt = (v) => (v === null || v === undefined || v === "" ? null : Number.parseInt(v, 10) || 0);

// The old app gave both air-filter groups "ai-N" ids, so the same id existed twice.
// Give each building its own prefix (matches supabase/seed.sql).
const remapId = (i) => {
  const m = /^Air Filters\s+(\S+)/.exec(i.group || "");
  if (m && /^ai-/.test(String(i.id))) return `f${m[1].toLowerCase()}-${String(i.id).slice(3)}`;
  return String(i.id);
};

// ── Inventory ──
const items = JSON.parse(fs.readFileSync(invFile, "utf8"));
const rows = items.map((i) => ({
  id: remapId(i),
  group: i.group || "Misc",
  name: i.name || "",
  part_number: i.partNumber || "",
  qty: Math.max(0, toInt(i.qty) ?? 0),
  min_qty: Math.max(0, toInt(i.minQty) ?? 0),
  notes: i.notes || "",
  location: i.location || "",
  category: i.category || "",
  photo: i.photo || null,
  photo_failed: !!i.photoFailed,
  unit_id: i.unitId ?? null,
  qty_units: toInt(i.qtyUnits),
  qty_per_unit: i.qtyPerUnit === undefined || i.qtyPerUnit === null ? null : String(i.qtyPerUnit),
  total_needed: toInt(i.totalNeeded),
  created_by: i.createdBy || "Import",
  updated_by: i.updatedBy || null,
  created_at: i.createdAt || new Date().toISOString(),
  updated_at: i.lastUpdated || new Date().toISOString(),
}));

for (let i = 0; i < rows.length; i += 200) {
  const chunk = rows.slice(i, i + 200);
  const { error } = await supabase
    .from("inventory_items")
    .upsert(chunk, { onConflict: "id", ignoreDuplicates: !overwrite });
  if (error) { console.error("inventory upsert failed:", error.message); process.exit(1); }
}
console.log(`Inventory: ${rows.length} items ${overwrite ? "upserted" : "inserted where missing"}`);

// ── Activity logs ──
if (fs.existsSync(logFile)) {
  const logs = JSON.parse(fs.readFileSync(logFile, "utf8"));
  const logRows = logs.map((l) => ({
    id: String(l.id),
    action: l.action || "Note",
    detail: l.detail || "",
    user_name: l.user || "System",
    user_id: null,
    ts: l.ts || new Date().toISOString(),
  }));
  for (let i = 0; i < logRows.length; i += 200) {
    const { error } = await supabase
      .from("activity_logs")
      .upsert(logRows.slice(i, i + 200), { onConflict: "id", ignoreDuplicates: true });
    if (error) { console.error("log upsert failed:", error.message); process.exit(1); }
  }
  console.log(`Logs: ${logRows.length} entries imported`);
}
console.log("Done.");

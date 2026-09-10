"use client";
import { useState } from "react";
import { INVENTORY_GROUPS, type Item } from "@/lib/types";
import { S, F } from "./styles";

export type ItemFormData = Partial<Item> & { name: string; group: string };

export function ItemForm({ item, activeGroup, onSave, onCancel }: { item: Item | null; activeGroup: string; onSave: (d: ItemFormData) => void | Promise<void>; onCancel: () => void }) {
  const isFilter = activeGroup?.startsWith("Air Filters");
  const [f, setF] = useState<ItemFormData>({
    name: item?.name || "", group: item?.group || activeGroup, qty: item?.qty ?? 1,
    minQty: item?.minQty ?? 0, partNumber: item?.partNumber || "", location: item?.location || "",
    notes: item?.notes || "",
    ...(isFilter ? {
      unitId: item?.unitId || "",
      qtyUnits: item?.qtyUnits ?? 0,
      qtyPerUnit: item?.qtyPerUnit ?? "0",
      totalNeeded: item?.totalNeeded ?? 0,
    } : {}),
  });
  const set = <K extends keyof ItemFormData>(k: K, v: ItemFormData[K]) => setF((prev) => ({ ...prev, [k]: v }));
  const num = (v: string) => Math.max(0, parseInt(v, 10) || 0);

  return (
    <div style={{ ...S.card, border: "1.5px solid #e2e8f0", marginBottom: 12 }}>
      <h3 style={{ fontFamily: F.heading, fontSize: 15, color: "#1e293b", margin: "0 0 12px" }}>{item ? "Edit Item" : "New Item"}</h3>
      {isFilter ? (
        <>
          <label style={S.label}>Unit ID *</label>
          <input style={S.input} value={f.unitId ?? ""} onChange={(e) => set("unitId", e.target.value)} placeholder="e.g. AHU #1–#4" />
          <label style={S.label}>Filter Size (Name) *</label>
          <input style={S.input} value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Merv 13 24x24x4" />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            <div><label style={S.label}># Units</label><input style={S.input} type="number" min="0" value={f.qtyUnits ?? 0} onChange={(e) => set("qtyUnits", num(e.target.value))} /></div>
            <div><label style={S.label}>Per Unit</label><input style={S.input} value={f.qtyPerUnit ?? ""} onChange={(e) => set("qtyPerUnit", e.target.value)} placeholder="e.g. 15 or 8/8/12" /></div>
            <div><label style={S.label}>Total Needed</label><input style={S.input} type="number" min="0" value={f.totalNeeded ?? 0} onChange={(e) => set("totalNeeded", num(e.target.value))} /></div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div><label style={S.label}>In Stock</label><input style={S.input} type="number" min="0" value={f.qty ?? 0} onChange={(e) => set("qty", num(e.target.value))} /></div>
            <div><label style={S.label}>Group</label><select style={{ ...S.select, width: "100%" }} value={f.group} onChange={(e) => set("group", e.target.value)}>{INVENTORY_GROUPS.filter((g) => g.startsWith("Air Filters")).map((c) => <option key={c}>{c}</option>)}</select></div>
          </div>
          <label style={S.label}>Notes</label>
          <textarea style={{ ...S.input, minHeight: 50, resize: "vertical" }} value={f.notes ?? ""} onChange={(e) => set("notes", e.target.value)} placeholder="Optional notes…" />
        </>
      ) : (
        <>
          <label style={S.label}>Name *</label>
          <input style={S.input} value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Sloan Faucet Kit" />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div><label style={S.label}>Group</label><select style={{ ...S.select, width: "100%" }} value={f.group} onChange={(e) => set("group", e.target.value)}>{INVENTORY_GROUPS.map((c) => <option key={c}>{c}</option>)}</select></div>
            <div><label style={S.label}>Part #</label><input style={S.input} value={f.partNumber ?? ""} onChange={(e) => set("partNumber", e.target.value)} placeholder="Optional" /></div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div><label style={S.label}>Quantity</label><input style={S.input} type="number" min="0" value={f.qty ?? 0} onChange={(e) => set("qty", num(e.target.value))} /></div>
            <div><label style={S.label}>Min Stock Alert</label><input style={S.input} type="number" min="0" value={f.minQty ?? 0} onChange={(e) => set("minQty", num(e.target.value))} /></div>
          </div>
          <label style={S.label}>Storage Location</label>
          <input style={S.input} value={f.location ?? ""} onChange={(e) => set("location", e.target.value)} placeholder="e.g. Van #2, Shelf B3" />
          <label style={S.label}>Notes</label>
          <textarea style={{ ...S.input, minHeight: 60, resize: "vertical" }} value={f.notes ?? ""} onChange={(e) => set("notes", e.target.value)} placeholder="Optional notes…" />
        </>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button style={S.btnPrimary} onClick={() => { if (!f.name.trim()) return; void onSave(f); }}>Save</button>
        <button style={S.btnSecondary} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

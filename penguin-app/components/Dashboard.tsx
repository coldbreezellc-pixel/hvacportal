"use client";
import type { Item } from "@/lib/types";
import { setView } from "@/lib/store";
import { setActiveGroup } from "./inventoryState";
import { S, F } from "./styles";

export function Dashboard({ items, lowStock }: { items: Item[]; lowStock: Item[] }) {
  const totalItems = items.length;
  const totalUnits = items.reduce((s, i) => s + (i.qty || 0), 0);
  const groups: Record<string, { count: number; units: number; zero: number }> = {};
  items.forEach((i) => {
    const g = i.group || "Misc";
    if (!groups[g]) groups[g] = { count: 0, units: 0, zero: 0 };
    groups[g].count++;
    groups[g].units += i.qty || 0;
    if ((i.qty || 0) === 0) groups[g].zero++;
  });

  return (
    <div className="pg-page">
      <h2 style={S.pageTitle}>Dashboard</h2>
      <div className="pg-stat-row" style={S.statRow}>
        <div style={{ ...S.statCard, borderLeft: "3px solid #38bdf8" }}>
          <div style={S.statNum}>{totalItems}</div>
          <div style={S.statLabel}>Item Types</div>
        </div>
        <div style={{ ...S.statCard, borderLeft: "3px solid #4ade80" }}>
          <div style={S.statNum}>{totalUnits}</div>
          <div style={S.statLabel}>Total Units</div>
        </div>
        <div style={{ ...S.statCard, borderLeft: lowStock.length ? "3px solid #f59e0b" : "3px solid #334155" }}>
          <div style={{ ...S.statNum, color: lowStock.length ? "#f59e0b" : "#e2e8f0" }}>{lowStock.length}</div>
          <div style={S.statLabel}>Low Stock</div>
        </div>
      </div>

      <div style={S.card}>
        <h3 style={{ fontFamily: F.heading, fontSize: 14, color: "#64748b", margin: "0 0 12px" }}>Inventory Groups</h3>
        {Object.entries(groups).sort((a, b) => b[1].units - a[1].units).map(([group, data]) => (
          <div key={group} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, cursor: "pointer", padding: "10px 12px", borderRadius: 10, background: "#ffffff", border: "1.5px solid #e2e8f0", boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}
            onClick={() => { setActiveGroup(group); setView("inventory"); }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: F.heading, fontSize: 14, color: "#0f172a", fontWeight: 700, marginBottom: 2 }}>{group}</div>
              <div style={{ fontFamily: F.body, fontSize: 11, color: "#64748b" }}>{data.count} items · {data.units} units{data.zero > 0 ? ` · ${data.zero} out of stock` : ""}</div>
              <div style={{ height: 5, borderRadius: 3, background: "#e2e8f0", overflow: "hidden", marginTop: 4 }}>
                <div style={{ height: "100%", borderRadius: 3, background: "#0d9488", width: `${Math.min(100, (data.units / Math.max(1, totalUnits)) * 100)}%`, transition: "width .4s" }} />
              </div>
            </div>
            <span style={{ fontFamily: F.mono, fontSize: 14, color: "#64748b" }}>→</span>
          </div>
        ))}
        {Object.keys(groups).length === 0 && <p style={{ fontFamily: F.body, fontSize: 13, color: "#64748b" }}>No items yet.</p>}
      </div>

      {lowStock.length > 0 && (
        <div style={{ ...S.card, border: "1px solid #fbbf24", background: "#fffbeb" }}>
          <h3 style={{ fontFamily: F.heading, fontSize: 14, color: "#f59e0b", margin: "0 0 10px" }}>⚠ Low Stock Alerts</h3>
          {lowStock.map((i) => (
            <div key={i.id} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #fef3c7", fontFamily: F.body, fontSize: 13 }}>
              <span style={{ color: "#1e293b" }}>{i.name} <span style={{ color: "#64748b" }}>({i.group})</span></span>
              <span style={{ color: "#f59e0b", fontWeight: 600 }}>{i.qty} / {i.minQty} min</span>
            </div>
          ))}
        </div>
      )}
      <div style={{ height: 80 }} />
    </div>
  );
}

"use client";
import { useState } from "react";
import type { LogEntry } from "@/lib/types";
import { S, F } from "./styles";

const ACTION_TYPES = ["All", "Login", "Logout", "Qty Changed", "Item Added", "Item Updated", "Item Deleted", "Stock Reset", "WO Created", "WO Updated", "WO Deleted", "Visit Logged", "User Created", "User Updated", "User Deleted", "Password Reset", "Password Changed", "Backup Taken", "Backup Restored"];

const actionColor = (a: string) => {
  if (a === "Login" || a === "Logout") return "#38bdf8";
  if (a.includes("Deleted")) return "#ef4444";
  if (a.includes("Created") || a.includes("Added") || a.includes("Logged")) return "#4ade80";
  if (a.includes("Changed") || a.includes("Updated") || a.includes("Reset")) return "#f59e0b";
  return "#94a3b8";
};

const formatTime = (ts: string) => {
  const d = new Date(ts);
  const today = new Date();
  const isToday = d.toDateString() === today.toDateString();
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  const isYesterday = d.toDateString() === yesterday.toDateString();
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (isToday) return `Today ${time}`;
  if (isYesterday) return `Yesterday ${time}`;
  return d.toLocaleDateString([], { month: "short", day: "numeric" }) + ` ${time}`;
};

export function LogsView({ logs }: { logs: LogEntry[] }) {
  const [filter, setFilter] = useState("All");
  const [search, setSearch] = useState("");
  const [dateRange, setDateRange] = useState("all");

  const now = Date.now();
  const filtered = logs.filter((l) => {
    if (filter !== "All" && l.action !== filter) return false;
    const q = search.toLowerCase();
    if (q && !l.detail.toLowerCase().includes(q) && !l.user.toLowerCase().includes(q)) return false;
    if (dateRange !== "all") {
      const d = new Date(l.ts);
      if (dateRange === "today") {
        if (d.toDateString() !== new Date().toDateString()) return false;
      } else if (dateRange === "week") {
        if (now - d.getTime() > 7 * 24 * 60 * 60 * 1000) return false;
      } else if (dateRange === "month") {
        if (now - d.getTime() > 30 * 24 * 60 * 60 * 1000) return false;
      }
    }
    return true;
  });

  return (
    <div className="pg-page">
      <h2 style={S.pageTitle}>Activity Log</h2>

      <input style={{ ...S.input, marginBottom: 8 }} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search logs…" />
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <select style={S.select} value={filter} onChange={(e) => setFilter(e.target.value)}>
          {ACTION_TYPES.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <select style={S.select} value={dateRange} onChange={(e) => setDateRange(e.target.value)}>
          <option value="all">All Time</option>
          <option value="today">Today</option>
          <option value="week">Last 7 Days</option>
          <option value="month">Last 30 Days</option>
        </select>
      </div>

      <p style={{ fontFamily: F.body, fontSize: 12, color: "#64748b", marginBottom: 8 }}>{filtered.length} entries</p>

      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {filtered.map((l) => (
          <div key={l.id} style={{ background: "#ffffff", borderRadius: 10, padding: "11px 14px", boxShadow: "0 1px 2px rgba(0,0,0,0.04)", border: "1px solid #f1f5f9" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                  <span style={{ fontFamily: F.body, fontSize: 11, fontWeight: 600, color: actionColor(l.action), background: actionColor(l.action) + "18", padding: "2px 8px", borderRadius: 10 }}>{l.action}</span>
                  <span style={{ fontFamily: F.body, fontSize: 11, color: "#64748b" }}>{l.user}</span>
                </div>
                <p style={{ fontFamily: F.body, fontSize: 13, color: "#334155", margin: 0 }}>{l.detail}</p>
              </div>
              <span style={{ fontFamily: F.mono, fontSize: 10, color: "#64748b", whiteSpace: "nowrap", marginTop: 2 }}>{formatTime(l.ts)}</span>
            </div>
          </div>
        ))}
        {filtered.length === 0 && <p style={{ fontFamily: F.body, fontSize: 13, color: "#64748b", textAlign: "center", padding: 32 }}>No log entries{filter !== "All" || search ? " match your filters" : " yet"}.</p>}
      </div>
      <div style={{ height: 80 }} />
    </div>
  );
}

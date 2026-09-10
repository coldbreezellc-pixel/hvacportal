"use client";
import type { Item, User, WorkOrder } from "@/lib/types";
import { setView, type View } from "@/lib/store";
import { Diamond } from "./Diamond";
import { S, F } from "./styles";

const OLD_PORTAL = process.env.NEXT_PUBLIC_OLD_PORTAL_URL || "https://local68.up.railway.app";

interface Tile { icon: string; title: string; desc: string; badge: string; badgeColor: string; view?: View; href?: string; adminOnly?: boolean; iconBg: string }

export function HomeView({ user, items, workOrders }: { user: User; items: Item[]; workOrders: WorkOrder[] }) {
  const isAdmin = user.role === "admin";
  const openWos = workOrders.filter((w) => w.status !== "Completed").length;
  const urgent = workOrders.filter((w) => w.status !== "Completed" && w.priority === "Urgent").length;
  const lowStock = items.filter((i) => (i.qty || 0) <= (i.minQty || 0) && (i.minQty || 0) > 0).length;
  const outOfStock = items.filter((i) => (i.qty || 0) === 0).length;

  const allTiles: Tile[] = [
    { icon: "🔧", title: "Work Orders", desc: "Track jobs, hours & visits", badge: openWos ? `${openWos} open` : "● Live", badgeColor: urgent ? "#dc2626" : "#16a34a", view: "workorders", iconBg: "rgba(230,81,0,.12)" },
    { icon: "📦", title: "Inventories", desc: "Equipment & parts tracking", badge: lowStock ? `${lowStock} low stock` : "● Live", badgeColor: lowStock ? "#f59e0b" : "#16a34a", view: "inventory", iconBg: "rgba(13,148,136,.12)" },
    { icon: "📋", title: "PM Sheet", desc: "Preventive maintenance work orders", badge: "Old portal", badgeColor: "#64748b", href: `${OLD_PORTAL}/pm/index.html`, iconBg: "rgba(41,121,255,.12)" },
    { icon: "📁", title: "PM Records", desc: "Browse all completed PMs", badge: "Old portal", badgeColor: "#64748b", href: `${OLD_PORTAL}/pm-records/`, iconBg: "rgba(46,125,50,.12)" },
    { icon: "🌴", title: "Time Off", desc: "Days off, coverage & overtime", badge: "Old portal", badgeColor: "#64748b", href: `${OLD_PORTAL}/time-off/`, iconBg: "rgba(0,137,123,.14)" },
    { icon: "📊", title: "Dashboard", desc: "Stock levels at a glance", badge: outOfStock ? `${outOfStock} out of stock` : "● Live", badgeColor: outOfStock ? "#ef4444" : "#16a34a", view: "dashboard", iconBg: "rgba(56,189,248,.14)" },
    { icon: "👥", title: "Users", desc: "Crew logins & roles", badge: "Admin", badgeColor: "#7c3aed", view: "users", adminOnly: true, iconBg: "rgba(124,58,237,.12)" },
    { icon: "📋", title: "Activity Log", desc: "Who changed what, when", badge: "Admin", badgeColor: "#7c3aed", view: "logs", adminOnly: true, iconBg: "rgba(124,58,237,.12)" },
    { icon: "🗄", title: "Backups", desc: "Hourly snapshots & restore", badge: "Admin", badgeColor: "#7c3aed", view: "backups", adminOnly: true, iconBg: "rgba(124,58,237,.12)" },
  ];
  const tiles = allTiles.filter((t) => !t.adminOnly || isAdmin);

  const hour = new Date().getHours();
  const greet = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  const tileStyle: React.CSSProperties = { background: "#ffffff", border: "1.5px solid #e2e8f0", borderRadius: 14, padding: "18px 16px", textAlign: "left", cursor: "pointer", boxShadow: "0 1px 3px rgba(0,0,0,0.04)", display: "block", textDecoration: "none", color: "inherit", width: "100%" };
  const inner = (t: Tile) => (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, background: t.iconBg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24 }}>{t.icon}</div>
        <span style={{ fontFamily: F.body, fontSize: 10, fontWeight: 700, color: t.badgeColor, background: t.badgeColor + "18", padding: "3px 8px", borderRadius: 10, whiteSpace: "nowrap" }}>{t.badge}</span>
      </div>
      <div style={{ fontFamily: F.heading, fontSize: 15, color: "#0f172a", fontWeight: 800, marginTop: 12 }}>{t.title}{t.href && <span style={{ fontSize: 11, color: "#94a3b8", marginLeft: 6 }}>↗</span>}</div>
      <div style={{ fontFamily: F.body, fontSize: 12, color: "#64748b", marginTop: 3 }}>{t.desc}</div>
    </>
  );

  return (
    <div className="pg-page">
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
        <Diamond size={40} />
        <div>
          <div style={{ fontFamily: F.body, fontSize: 12, color: "#64748b" }}>{greet},</div>
          <h2 style={{ ...S.pageTitle, margin: 0, fontSize: 20 }}>{user.displayName}</h2>
        </div>
      </div>

      <div className="pg-stat-row" style={S.statRow}>
        <div style={{ ...S.statCard, borderLeft: `3px solid ${urgent ? "#dc2626" : "#f97316"}`, cursor: "pointer" }} onClick={() => setView("workorders")}>
          <div style={S.statNum}>{openWos}</div>
          <div style={S.statLabel}>Open work orders{urgent ? ` · ${urgent} urgent` : ""}</div>
        </div>
        <div style={{ ...S.statCard, borderLeft: `3px solid ${lowStock ? "#f59e0b" : "#4ade80"}`, cursor: "pointer" }} onClick={() => setView("dashboard")}>
          <div style={{ ...S.statNum, color: lowStock ? "#f59e0b" : "#0f172a" }}>{lowStock}</div>
          <div style={S.statLabel}>Low stock items</div>
        </div>
        <div style={{ ...S.statCard, borderLeft: "3px solid #38bdf8" }}>
          <div style={S.statNum}>{items.length}</div>
          <div style={S.statLabel}>Parts tracked</div>
        </div>
      </div>

      <div className="pg-groups-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {tiles.map((t) => t.href ? (
          <a key={t.title} href={t.href} target="_blank" rel="noopener noreferrer" style={tileStyle}>{inner(t)}</a>
        ) : (
          <button key={t.title} type="button" style={tileStyle} onClick={() => setView(t.view!)}>{inner(t)}</button>
        ))}
      </div>
      <p style={{ fontFamily: F.body, fontSize: 11, color: "#94a3b8", textAlign: "center", marginTop: 18 }}>
        Tiles marked “Old portal” open the previous site until they move here. © {new Date().getFullYear()} Local 68 — HVAC Engineering
      </p>
      <div style={{ height: 80 }} />
    </div>
  );
}

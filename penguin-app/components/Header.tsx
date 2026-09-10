"use client";
import { useState } from "react";
import type { User } from "@/lib/types";
import type { View } from "@/lib/store";
import { Diamond } from "./Diamond";
import { S, F } from "./styles";

interface Props {
  user: User;
  view: View;
  setView: (v: View) => void;
  logout: () => void;
  lowStock: number;
  openWos: number;
  online: boolean;
  pending: number;
  syncing: boolean;
}

function SyncStatus({ online, pending, syncing }: { online: boolean; pending: number; syncing: boolean }) {
  if (!online) return <span className="pg-status pg-status--offline" title="No connection — edits are queued"><span className="pg-dot" />Offline{pending ? ` · ${pending} queued` : ""}</span>;
  if (syncing) return <span className="pg-status pg-status--syncing"><span className="pg-dot" />Syncing{pending ? ` ${pending}` : ""}…</span>;
  if (pending > 0) return <span className="pg-status pg-status--pending" title="Waiting to upload"><span className="pg-dot" />{pending} pending</span>;
  return <span className="pg-status pg-status--online" title="Live — changes sync instantly"><span className="pg-dot" />Live</span>;
}

export function Header({ user, view, setView, logout, lowStock, openWos, online, pending, syncing }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const isAdmin = user.role === "admin";
  // Phone bottom bar: the five things people tap all day.
  const navItems: { key: View; label: string; icon: string }[] = [
    { key: "home", label: "Home", icon: "🏠" },
    { key: "workorders", label: "Work Orders", icon: "🔧" },
    { key: "pmsheet", label: "PM Sheet", icon: "📋" },
    { key: "inventory", label: "Inventory", icon: "📦" },
    { key: "profile", label: "Profile", icon: "⚙" },
  ];
  // Drawer / desktop sidebar: everything.
  const menuItems: { key: View; label: string; icon: string }[] = [
    { key: "home", label: "Home", icon: "🏠" },
    { key: "workorders", label: "Work Orders", icon: "🔧" },
    { key: "pmsheet", label: "PM Sheet", icon: "📋" },
    { key: "pmrecords", label: "PM Records", icon: "📁" },
    { key: "inventory", label: "Inventory", icon: "📦" },
    { key: "dashboard", label: "Stock Dashboard", icon: "📊" },
    ...(isAdmin ? [{ key: "users" as View, label: "Users", icon: "👥" }, { key: "logs" as View, label: "Activity Log", icon: "📋" }, { key: "backups" as View, label: "Backups", icon: "🗄" }] : []),
    { key: "profile", label: "Profile", icon: "⚙" },
  ];
  const go = (k: View) => { setView(k); setMenuOpen(false); };

  return (
    <>
      {/* Desktop sidebar (hidden on phones) */}
      <aside className="pg-sidebar">
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 10px 18px" }}>
          <Diamond size={32} />
          <div>
            <div style={{ fontFamily: F.heading, fontSize: 15, color: "#0f172a", letterSpacing: 1.5, fontWeight: 800 }}>PENGUIN</div>
            <div style={{ fontFamily: F.body, fontSize: 10, color: "#0d9488", letterSpacing: 1, fontWeight: 700 }}>MAINTENANCE · LOCAL 68</div>
          </div>
        </div>
        {menuItems.map((n) => (
          <button key={n.key} className={`pg-sidebar-item${view === n.key ? " pg-sidebar-item--active" : ""}`} onClick={() => go(n.key)}>
            <span>{n.icon}</span> {n.label}
            {n.key === "dashboard" && lowStock > 0 && <span style={{ ...S.badge, marginLeft: "auto" }}>{lowStock}</span>}
            {n.key === "workorders" && openWos > 0 && <span style={{ ...S.badge, marginLeft: "auto", background: "#0d9488" }}>{openWos}</span>}
          </button>
        ))}
        <div style={{ marginTop: "auto", borderTop: "1px solid #e2e8f0", paddingTop: 12 }}>
          <div style={{ padding: "6px 14px 10px" }}>
            <SyncStatus online={online} pending={pending} syncing={syncing} />
          </div>
          <div style={{ padding: "0 14px 8px" }}>
            <p style={{ fontFamily: F.heading, color: "#0f172a", margin: 0, fontSize: 14 }}>{user.displayName}</p>
            <p style={{ fontFamily: F.body, color: "#64748b", margin: "2px 0 0", fontSize: 12 }}>{isAdmin ? "Administrator" : "Crew Member"}</p>
          </div>
          <button className="pg-sidebar-item" style={{ color: "#dc2626" }} onClick={logout}>🚪 Sign Out</button>
        </div>
      </aside>

      {/* Mobile header */}
      <header style={S.header}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }} onClick={() => setView("home")}>
          <Diamond size={28} />
          <span style={{ fontFamily: F.heading, fontSize: 15, color: "#0f172a", letterSpacing: 1.5, fontWeight: 700 }}>PENGUIN</span>
          {lowStock > 0 && <span style={S.badge}>{lowStock}</span>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <SyncStatus online={online} pending={pending} syncing={syncing} />
          <button className="pg-hamburger" style={S.hamburger} onClick={() => setMenuOpen(!menuOpen)} aria-label="Menu">
            <span style={{ fontSize: 22 }}>{menuOpen ? "✕" : "☰"}</span>
          </button>
        </div>
      </header>
      {menuOpen && <div className="pg-overlay" style={S.menuOverlay} onClick={() => setMenuOpen(false)} />}
      <div className="pg-drawer" style={{ ...S.drawer, transform: menuOpen ? "translateX(0)" : "translateX(100%)" }}>
        <div style={{ padding: "20px 16px 12px", borderBottom: "1px solid #f1f5f9" }}>
          <p style={{ fontFamily: F.heading, color: "#0f172a", margin: 0, fontSize: 15 }}>{user.displayName}</p>
          <p style={{ fontFamily: F.body, color: "#64748b", margin: "2px 0 0", fontSize: 12 }}>{isAdmin ? "Administrator" : "Crew Member"}</p>
        </div>
        {menuItems.map((n) => (
          <button key={n.key} style={{ ...S.drawerItem, background: view === n.key ? "#f1f5f9" : "transparent" }} onClick={() => go(n.key)}>
            <span>{n.icon}</span> {n.label}
          </button>
        ))}
        <div style={{ borderTop: "1px solid #e2e8f0", marginTop: 8, paddingTop: 8 }}>
          <button style={{ ...S.drawerItem, color: "#dc2626" }} onClick={logout}>🚪 Sign Out</button>
        </div>
      </div>

      {/* Bottom nav for mobile */}
      <nav className="pg-bottomnav" style={S.bottomNav}>
        {navItems.map((n) => (
          <button key={n.key} style={{ ...S.bottomNavBtn, color: view === n.key ? "#0d9488" : "#94a3b8" }} onClick={() => setView(n.key)}>
            <span style={{ fontSize: 18 }}>{n.icon}</span>
            <span style={{ fontSize: 10, marginTop: 2 }}>{n.label}</span>
          </button>
        ))}
      </nav>
    </>
  );
}

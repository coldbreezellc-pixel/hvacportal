import type { CSSProperties } from "react";

export const F = {
  heading: "var(--font-jakarta), 'Plus Jakarta Sans', 'Segoe UI', system-ui, sans-serif",
  body: "var(--font-jakarta), 'Plus Jakarta Sans', 'Segoe UI', system-ui, sans-serif",
  mono: "var(--font-mono), 'JetBrains Mono', 'Courier New', monospace",
};

// Kept for pages rendered outside the main shell (reset-password); the global
// rules live in app/globals.css.
export const globalCSS = ``;

type Styles = Record<string, CSSProperties>;

export const S = {
  shell: { minHeight: "100vh", background: "#f1f5f9", color: "#1e293b", paddingBottom: 74 },
  loadWrap: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100vh", background: "#f1f5f9" },
  spinner: { width: 36, height: 36, border: "3px solid #e2e8f0", borderTopColor: "#0d9488", borderRadius: "50%", animation: "spin 0.8s linear infinite" },

  // Auth
  authWrap: { display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", padding: 16, background: "linear-gradient(160deg, #0f172a 0%, #1e293b 100%)" },
  authCard: { width: "100%", maxWidth: 380, background: "#ffffff", borderRadius: 16, padding: 32, boxShadow: "0 20px 60px rgba(0,0,0,0.3)" },

  // Header
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 16px", background: "#ffffff", boxShadow: "0 1px 3px rgba(0,0,0,0.06)", position: "sticky", top: 0, zIndex: 50 },
  hamburger: { background: "none", border: "none", color: "#64748b", cursor: "pointer", padding: 4 },
  badge: { background: "#f59e0b", color: "#fff", fontFamily: F.mono, fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 10 },
  menuOverlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.3)", zIndex: 98 },
  drawer: { position: "fixed", top: 0, right: 0, bottom: 0, width: 260, background: "#ffffff", boxShadow: "-4px 0 20px rgba(0,0,0,0.1)", zIndex: 99, transition: "transform .25s ease", overflowY: "auto" },
  drawerItem: { display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "13px 18px", background: "none", border: "none", color: "#334155", fontFamily: F.body, fontSize: 14, cursor: "pointer", textAlign: "left", fontWeight: 500 },

  // Bottom nav
  bottomNav: { position: "fixed", bottom: 0, left: 0, right: 0, display: "flex", justifyContent: "space-around", background: "#ffffff", boxShadow: "0 -1px 6px rgba(0,0,0,0.06)", padding: "6px 0 env(safe-area-inset-bottom, 8px)", zIndex: 50 },
  bottomNavBtn: { display: "flex", flexDirection: "column", alignItems: "center", background: "none", border: "none", cursor: "pointer", fontFamily: F.body, padding: "4px 12px" },

  // Page
  page: { padding: "20px 16px 0", maxWidth: 600, margin: "0 auto", animation: "slideUp .3s ease" },
  pageTitle: { fontFamily: F.heading, fontSize: 22, color: "#0f172a", margin: "0 0 16px", fontWeight: 800 },

  // Cards
  card: { background: "#ffffff", borderRadius: 12, padding: 18, marginBottom: 12, boxShadow: "0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.06)" },
  itemCard: { background: "#ffffff", borderRadius: 10, padding: "12px 14px", boxShadow: "0 1px 2px rgba(0,0,0,0.04)", border: "1px solid #e2e8f0", marginBottom: 8 },

  // Stats
  statRow: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 16 },
  statCard: { background: "#ffffff", borderRadius: 12, padding: "16px 14px", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" },
  statNum: { fontFamily: F.mono, fontSize: 26, fontWeight: 700, color: "#0f172a" },
  statLabel: { fontFamily: F.body, fontSize: 11, color: "#64748b", marginTop: 2, fontWeight: 500 },

  // Form elements
  label: { display: "block", fontFamily: F.body, fontSize: 12, color: "#64748b", marginBottom: 5, marginTop: 12, fontWeight: 600, letterSpacing: 0.2 },
  input: { width: "100%", padding: "11px 14px", background: "#f8fafc", border: "1.5px solid #e2e8f0", borderRadius: 10, color: "#1e293b", fontFamily: F.body, fontSize: 14, transition: "border-color .2s, box-shadow .2s" },
  select: { padding: "11px 14px", background: "#f8fafc", border: "1.5px solid #e2e8f0", borderRadius: 10, color: "#1e293b", fontFamily: F.body, fontSize: 13, flex: 1 },

  // Buttons
  btnPrimary: { padding: "11px 22px", background: "#0d9488", border: "none", borderRadius: 10, color: "#fff", fontFamily: F.body, fontSize: 14, fontWeight: 700, cursor: "pointer", width: "100%", transition: "background .2s" },
  btnSecondary: { padding: "9px 16px", background: "#f1f5f9", border: "1.5px solid #e2e8f0", borderRadius: 10, color: "#64748b", fontFamily: F.body, fontSize: 13, cursor: "pointer", fontWeight: 600 },
  btnLink: { display: "block", background: "none", border: "none", color: "#0d9488", fontFamily: F.body, fontSize: 13, cursor: "pointer", marginTop: 16, textAlign: "center", fontWeight: 600, width: "100%" },
  qtyBtn: { width: 34, height: 34, borderRadius: 10, background: "#f1f5f9", border: "1.5px solid #e2e8f0", color: "#334155", fontSize: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700 },
  qtyBtnSm: { width: 22, height: 22, borderRadius: 6, background: "#f1f5f9", border: "1.5px solid #e2e8f0", color: "#334155", fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700 },
  qtyInput: { fontFamily: F.mono, fontSize: 13, width: 46, textAlign: "center", border: "2px solid #0d9488", borderRadius: 4, padding: "1px 0", outline: "none", color: "#0f172a", background: "#f0fdfa", fontWeight: 700 },

  // Detail
  detailLine: { fontFamily: F.body, fontSize: 13, color: "#64748b", margin: "5px 0" },

  // Big action buttons
  btnExport: { width: "100%", padding: "14px", marginTop: 12, background: "linear-gradient(135deg, #0d9488, #0f766e)", border: "none", borderRadius: 10, color: "#fff", fontFamily: F.heading, fontSize: 14, fontWeight: 700, cursor: "pointer", letterSpacing: ".5px", boxShadow: "0 4px 16px rgba(13,148,136,0.3)" },
  btnDanger: { width: "100%", padding: "14px", marginTop: 12, background: "#dc2626", border: "none", borderRadius: 10, color: "#fff", fontFamily: F.heading, fontSize: 14, fontWeight: 700, cursor: "pointer", letterSpacing: ".5px", transition: "opacity .2s" },
  btnDel: { padding: "9px 16px", background: "#f1f5f9", border: "1.5px solid #fca5a5", borderRadius: 10, color: "#ef4444", fontFamily: F.body, fontSize: 13, cursor: "pointer", fontWeight: 600 },

  // Toast
  toast: { position: "fixed", top: 16, left: "50%", transform: "translateX(-50%)", padding: "11px 22px", borderRadius: 12, color: "#fff", fontFamily: F.body, fontSize: 13, fontWeight: 600, zIndex: 200, animation: "slideUp .3s ease", boxShadow: "0 8px 30px rgba(0,0,0,0.15)", maxWidth: "calc(100vw - 32px)", textAlign: "center" },
} satisfies Styles;

export const TEMP_PW_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
export const genTempPassword = (len = 8) => {
  let pw = "";
  for (let i = 0; i < len; i++) pw += TEMP_PW_CHARS[Math.floor(Math.random() * TEMP_PW_CHARS.length)];
  return pw;
};

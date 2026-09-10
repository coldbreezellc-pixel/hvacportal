"use client";
import { useEffect, useState, useCallback } from "react";
import { listBackups, takeBackupNow, restoreBackup, fetchBackup, type BackupMeta } from "@/lib/store";
import { S, F } from "./styles";

const kindColor: Record<string, string> = { hourly: "#38bdf8", manual: "#4ade80", "pre-restore": "#f59e0b" };

export function BackupsView({ online }: { online: boolean }) {
  const [rows, setRows] = useState<BackupMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<number | "now" | null>(null);
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [typed, setTyped] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setRows(await listBackups());
    setLoading(false);
  }, []);
  useEffect(() => { if (online) void load(); else setLoading(false); }, [online, load]);

  const download = async (id: number) => {
    setBusy(id);
    const b = await fetchBackup(id);
    setBusy(null);
    if (!b) return;
    const blob = new Blob([JSON.stringify(b, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `penguin-backup-${id}-${String(b.taken_at).slice(0, 16).replace(/[:T]/g, "-")}.json`; a.click();
    URL.revokeObjectURL(url);
  };

  const latest = rows[0];
  const ageMin = latest ? Math.round((Date.now() - new Date(latest.taken_at).getTime()) / 60000) : null;

  return (
    <div className="pg-page pg-page--narrow">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, gap: 10 }}>
        <h2 style={{ ...S.pageTitle, margin: 0 }}>Backups</h2>
        <button style={{ ...S.btnPrimary, width: "auto", opacity: busy === "now" || !online ? 0.6 : 1 }} disabled={busy === "now" || !online}
          onClick={async () => { setBusy("now"); if (await takeBackupNow()) await load(); setBusy(null); }}>
          {busy === "now" ? "Backing up…" : "⬇ Back Up Now"}
        </button>
      </div>

      <div style={S.card}>
        <p style={{ fontFamily: F.body, fontSize: 13, color: "#64748b", margin: 0 }}>
          A full snapshot (every item, user profile, and the last 5,000 log entries) is taken <b>every hour</b> automatically and kept
          for 7 days, then one per day for 180 days. Restoring puts the inventory back exactly as it was in that snapshot; a safety
          snapshot is taken first so a restore can be undone.
        </p>
        {latest && (
          <p style={{ fontFamily: F.body, fontSize: 12, color: ageMin !== null && ageMin > 120 ? "#dc2626" : "#16a34a", margin: "10px 0 0", fontWeight: 600 }}>
            Last snapshot: {new Date(latest.taken_at).toLocaleString()} ({ageMin} min ago)
            {ageMin !== null && ageMin > 120 && " — hourly job may not be running; check pg_cron in Supabase."}
          </p>
        )}
      </div>

      {!online && <p style={{ fontFamily: F.body, fontSize: 13, color: "#b45309" }}>Backups need a connection.</p>}
      {loading && <p style={{ fontFamily: F.body, fontSize: 13, color: "#64748b" }}>Loading…</p>}
      {!loading && online && rows.length === 0 && <p style={{ fontFamily: F.body, fontSize: 13, color: "#64748b" }}>No backups yet. Tap “Back Up Now”.</p>}

      {rows.map((b) => (
        <div key={b.id} style={S.itemCard}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontFamily: F.body, fontSize: 11, fontWeight: 600, color: kindColor[b.kind] || "#94a3b8", background: (kindColor[b.kind] || "#94a3b8") + "18", padding: "2px 8px", borderRadius: 10 }}>{b.kind}</span>
                <span style={{ fontFamily: F.heading, fontSize: 14, color: "#1e293b" }}>{new Date(b.taken_at).toLocaleString()}</span>
              </div>
              <div style={{ fontFamily: F.body, fontSize: 12, color: "#64748b", marginTop: 3 }}>
                #{b.id} · {b.item_count} items · {b.user_count} users · {b.log_count} log entries{b.note ? ` · ${b.note}` : ""}
              </div>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button style={S.btnSecondary} disabled={busy === b.id} onClick={() => download(b.id)}>{busy === b.id ? "…" : "⬇ JSON"}</button>
              <button style={S.btnDel} onClick={() => { setConfirmId(b.id); setTyped(""); }}>Restore</button>
            </div>
          </div>
          {confirmId === b.id && (
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #e2e8f0" }}>
              <p style={{ fontFamily: F.body, fontSize: 13, color: "#dc2626", margin: "0 0 8px" }}>
                This replaces the live inventory with snapshot #{b.id}. Type <b>RESTORE</b> to confirm.
              </p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <input style={{ ...S.input, flex: 1, minWidth: 140 }} value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="RESTORE" autoCapitalize="characters" />
                <button style={{ ...S.btnDel, opacity: typed === "RESTORE" && busy !== b.id ? 1 : 0.5 }} disabled={typed !== "RESTORE" || busy === b.id}
                  onClick={async () => { setBusy(b.id); const ok = await restoreBackup(b.id); setBusy(null); if (ok) { setConfirmId(null); await load(); } }}>
                  {busy === b.id ? "Restoring…" : "Yes, Restore"}
                </button>
                <button style={S.btnSecondary} onClick={() => setConfirmId(null)}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      ))}
      <div style={{ height: 80 }} />
    </div>
  );
}

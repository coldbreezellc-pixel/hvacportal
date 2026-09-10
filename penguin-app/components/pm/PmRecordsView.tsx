"use client";
import { useMemo, useState } from "react";
import type { User } from "@/lib/types";
import type { PmRecord } from "@/lib/pm/types";
import { formatPmDate } from "@/lib/pm/types";
import { deletePmRecord, resendPm, importLegacyPm, setView, flash } from "@/lib/store";
import { Lightbox } from "../Lightbox";
import { S, F } from "../styles";

const NAVY = "#1B3A5C", WARN = "#E65100";
const SAFETY_LABELS = ["PPE Condition", "Pre-Job Safety", "Electrical Safety", "Gas & Chemical Safety", "Post-Job"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const Box = ({ title, color = NAVY, children }: { title: string; color?: string; children: React.ReactNode }) => (
  <div style={{ ...S.card, padding: 0, overflow: "hidden" }}>
    <div style={{ background: color, color: "#fff", padding: "9px 14px", fontFamily: F.heading, fontSize: 13, fontWeight: 700 }}>{title}</div>
    <div style={{ padding: 14 }}>{children}</div>
  </div>
);

function RecordDetail({ record, isAdmin, online, onBack }: { record: PmRecord; isAdmin: boolean; online: boolean; onBack: () => void }) {
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const r = record;
  const icon = (s: { done: boolean; na: boolean }) => (s.done ? "✅" : s.na ? "➖" : "⬜");
  return (
    <div className="pg-page pg-page--narrow pg-print-area">
      {lightbox && <Lightbox src={lightbox} onClose={() => setLightbox(null)} />}
      <div className="pg-no-print" style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <button onClick={onBack} aria-label="Back" style={{ background: "none", border: "none", color: "#0d9488", fontSize: 24, cursor: "pointer", fontWeight: 700 }}>←</button>
        <h2 style={{ ...S.pageTitle, margin: 0, flex: 1, fontSize: 18 }}>{r.frequency === "Repair" ? "🔧 Repair" : `📋 ${r.frequency} PM`}</h2>
      </div>

      {r.followUp && (
        <div style={{ background: "#FEF2F2", border: "2px solid #DC2626", borderRadius: 10, padding: 14, marginBottom: 12, textAlign: "center" }}>
          <div style={{ fontFamily: F.heading, fontSize: 15, fontWeight: 800, color: "#DC2626" }}>⚠️ FOLLOW-UP REQUIRED</div>
          {r.followUpNotes && <div style={{ fontFamily: F.body, fontSize: 13, color: "#7F1D1D", marginTop: 6, whiteSpace: "pre-wrap" }}>{r.followUpNotes}</div>}
        </div>
      )}

      <Box title="📋 Work Order Details">
        {([["Equipment", r.equipment], ["Service", r.frequency], ["Facility", r.facility], ["Technician(s)", r.technician], ["Date", formatPmDate(r.pmDate)], ...(r.tasksCompleted ? [["Tasks", r.tasksCompleted]] : [])] as [string, string][]).map(([k, v]) => (
          <div key={k} style={{ display: "flex", gap: 10, padding: "5px 0", borderBottom: "1px solid #f1f5f9", fontFamily: F.body, fontSize: 13 }}><span style={{ width: 110, color: "#64748b", flexShrink: 0 }}>{k}</span><span style={{ fontWeight: 600, color: "#1e293b" }}>{v || "—"}</span></div>
        ))}
        <div style={{ display: "flex", gap: 10, padding: "5px 0", fontFamily: F.body, fontSize: 13 }}><span style={{ width: 110, color: "#64748b" }}>Follow-up</span><span style={{ fontWeight: 700, color: r.followUp ? "#DC2626" : "#16a34a" }}>{r.followUp ? "YES" : "No"}</span></div>
        {r.emailSentAt && <div style={{ fontFamily: F.body, fontSize: 11, color: "#94a3b8", marginTop: 8 }}>Emailed {new Date(r.emailSentAt).toLocaleString()} to {r.emailTo.join(", ")}</div>}
        {!r.emailSentAt && !r.legacyPath && <div style={{ fontFamily: F.body, fontSize: 11, color: "#b45309", marginTop: 8 }}>Email not sent yet{online ? "" : " (waiting for connection)"}.</div>}
      </Box>

      {r.generalComments && <Box title="💬 Comments / Findings"><div style={{ fontFamily: F.body, fontSize: 14, color: "#1e293b", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{r.generalComments}</div></Box>}

      {r.safetyData.length > 0 && (
        <Box title="🛡 Safety Checklist">
          {r.safetyData.map((section, si) => (
            <div key={si}>
              <div style={{ fontFamily: F.body, fontSize: 11, fontWeight: 800, color: "#64748b", textTransform: "uppercase", margin: "10px 0 4px" }}>{SAFETY_LABELS[si] || `Section ${si + 1}`}</div>
              {section.map((s, i) => <div key={i} style={{ fontFamily: F.body, fontSize: 13, padding: "2px 0" }}>{icon(s)} {s.task}{s.condition ? <span style={{ color: "#64748b" }}> ({s.condition})</span> : null}</div>)}
            </div>
          ))}
        </Box>
      )}

      {r.checklistData.length > 0 && (
        <Box title="🔧 PM Checklist">
          {r.checklistData.map((cl, i) => (
            <div key={i} style={{ marginBottom: 12 }}>
              <div style={{ fontFamily: F.body, fontSize: 13, fontWeight: 700, color: NAVY, borderBottom: "1px solid #e2e8f0", padding: "6px 0 4px", marginBottom: 4 }}>{cl.header}</div>
              {cl.tasks.map((t, j) => <div key={j} style={{ fontFamily: F.body, fontSize: 13, padding: "2px 0", color: "#334155" }}>{t.done ? "✅" : "⬜"} {t.text}</div>)}
              {cl.readings && Object.keys(cl.readings).length > 0 && <div style={{ fontFamily: F.body, fontSize: 12, color: "#334155", marginTop: 4 }}><b>Readings:</b> {Object.entries(cl.readings).map(([k, v]) => `${k}: ${v}`).join(" · ")}</div>}
              {cl.findings && <div style={{ marginTop: 6, padding: 8, background: "#FFF8E1", border: "1px solid #FFE082", borderRadius: 6, fontFamily: F.body, fontSize: 13, color: "#92400E", whiteSpace: "pre-wrap" }}><b>Findings:</b> {cl.findings}</div>}
            </div>
          ))}
        </Box>
      )}

      {r.postJobData.length > 0 && (
        <Box title="✅ Post-Job Checklist" color={WARN}>
          {r.postJobData.map((s, i) => <div key={i} style={{ fontFamily: F.body, fontSize: 13, padding: "2px 0" }}>{icon(s)} {s.task}</div>)}
        </Box>
      )}

      {r.photos.length > 0 && (
        <Box title={`📸 Photos (${r.photos.length})`} color={WARN}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {r.photos.map((p, i) => (
              <div key={i}>
                <img src={p.url} alt="" loading="lazy" style={{ width: "100%", aspectRatio: "4 / 3", objectFit: "cover", borderRadius: 8, border: "1px solid #e2e8f0", cursor: "zoom-in" }} onClick={() => setLightbox(p.url)} />
                <div style={{ fontFamily: F.body, fontSize: 12, color: "#64748b", marginTop: 4, fontWeight: 600 }}>📸 {p.caption || "Photo"}</div>
              </div>
            ))}
          </div>
        </Box>
      )}

      {r.signatureData.length > 0 && (
        <Box title="✍️ Signatures">
          {r.signatureData.map((s, i) => (
            <div key={i} style={{ margin: "6px 0", padding: 10, border: "1px solid #e2e8f0", borderRadius: 8, background: "#f8fafc" }}>
              <div style={{ fontFamily: F.body, fontSize: 13, fontWeight: 700, color: NAVY, marginBottom: 6 }}>{s.type === "safety" ? "🛡 Safety" : "✅ Completion"} — {s.name}</div>
              <img src={s.url} alt="" style={{ maxWidth: "100%", height: 70, border: "1px solid #e2e8f0", borderRadius: 4, background: "#fff" }} />
            </div>
          ))}
        </Box>
      )}

      <div className="pg-no-print" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
        <button style={{ ...S.btnSecondary, flex: 1 }} onClick={() => window.print()}>🖨 Print</button>
        {r.pdfUrl && <a href={r.pdfUrl} target="_blank" rel="noopener noreferrer" style={{ ...S.btnSecondary, flex: 1, textAlign: "center", textDecoration: "none", color: "#0d9488" }}>📄 PDF</a>}
        <button style={{ ...S.btnPrimary, flex: 1, opacity: busy || !online ? 0.6 : 1 }} disabled={!!busy || !online} onClick={async () => {
          if (!confirm(`Resend this PM report with PDF attached?\n\n${r.emailSubject || r.equipment}`)) return;
          setBusy("Building PDF…");
          try { await resendPm(r, (s) => setBusy(s)); } finally { setBusy(null); }
        }}>{busy || "📧 Resend"}</button>
        {isAdmin && !confirmDel && <button style={S.btnDel} onClick={() => setConfirmDel(true)}>Delete</button>}
        {isAdmin && confirmDel && (<>
          <button style={{ ...S.btnDel, flex: 1 }} onClick={() => { deletePmRecord(r.id); onBack(); }}>Yes, delete this record</button>
          <button style={S.btnSecondary} onClick={() => setConfirmDel(false)}>Cancel</button>
        </>)}
      </div>
      <p className="pg-no-print" style={{ fontFamily: F.body, fontSize: 11, color: "#94a3b8", textAlign: "center", marginTop: 14 }}>
        Archived {new Date(r.createdAt).toLocaleString()}{r.createdBy ? ` by ${r.createdBy}` : ""}{r.legacyPath ? " · imported from the old portal" : ""}
      </p>
      <div style={{ height: 80 }} />
    </div>
  );
}

export function PmRecordsView({ records, user, online }: { records: PmRecord[]; user: User; online: boolean }) {
  const isAdmin = user.role === "admin";
  const [openId, setOpenId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [onlyFollowUp, setOnlyFollowUp] = useState(false);
  const [openMonths, setOpenMonths] = useState<Record<string, boolean>>({});
  const [importing, setImporting] = useState(false);

  const q = search.toLowerCase().trim();
  const filtered = useMemo(() => records
    .filter((r) => !onlyFollowUp || r.followUp)
    .filter((r) => !q || [r.equipment, r.technician, r.facility, r.frequency, r.generalComments, r.followUpNotes].some((s) => (s || "").toLowerCase().includes(q)))
    .sort((a, b) => (b.pmDate + b.createdAt).localeCompare(a.pmDate + a.createdAt)), [records, q, onlyFollowUp]);

  // group by month (newest first), default-open the newest month
  const groups = useMemo(() => {
    const map = new Map<string, PmRecord[]>();
    for (const r of filtered) { const k = r.pmDate.slice(0, 7); if (!map.has(k)) map.set(k, []); map.get(k)!.push(r); }
    return [...map.entries()];
  }, [filtered]);

  const open = records.find((r) => r.id === openId);
  if (open) return <RecordDetail record={open} isAdmin={isAdmin} online={online} onBack={() => setOpenId(null)} />;

  const monthLabel = (k: string) => { const [y, m] = k.split("-"); return `${MONTHS[Number(m) - 1]} ${y}`; };
  const isOpen = (k: string, i: number) => openMonths[k] ?? (i === 0 || !!q);

  return (
    <div className="pg-page pg-page--narrow">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, gap: 8 }}>
        <h2 style={{ ...S.pageTitle, margin: 0 }}>📁 PM Records</h2>
        <button style={{ ...S.btnPrimary, width: "auto", padding: "10px 14px" }} onClick={() => setView("pmsheet")}>+ New PM</button>
      </div>
      <input style={S.input} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search equipment, tech, facility…" />
      <div style={{ display: "flex", gap: 8, margin: "10px 0 14px", alignItems: "center", flexWrap: "wrap" }}>
        <button onClick={() => setOnlyFollowUp(!onlyFollowUp)} style={{ padding: "6px 12px", borderRadius: 20, border: "1.5px solid", borderColor: onlyFollowUp ? "#DC2626" : "#e2e8f0", background: onlyFollowUp ? "#FEF2F2" : "#fff", color: onlyFollowUp ? "#DC2626" : "#64748b", fontFamily: F.body, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>⚠️ Follow-up only ({records.filter((r) => r.followUp).length})</button>
        <span style={{ fontFamily: F.body, fontSize: 12, color: "#64748b" }}>{filtered.length} of {records.length} records</span>
        {isAdmin && online && (
          <button style={{ ...S.btnSecondary, marginLeft: "auto", fontSize: 12, opacity: importing ? 0.6 : 1 }} disabled={importing} onClick={async () => {
            if (!confirm("Import the completed PMs archived on the old portal? Already-imported records are skipped.")) return;
            setImporting(true);
            try { const res = await importLegacyPm(); if (res) flash(`Imported ${res.imported} record(s), ${res.skipped} already present.`); } finally { setImporting(false); }
          }}>{importing ? "Importing…" : "⬇ Import old records"}</button>
        )}
      </div>

      {records.length === 0 && <p style={{ fontFamily: F.body, fontSize: 13, color: "#94a3b8", textAlign: "center", padding: 32 }}>No PM records yet. Complete a PM Sheet and it lands here with its PDF.</p>}

      {groups.map(([k, list], i) => (
        <div key={k} style={{ marginBottom: 10 }}>
          <button onClick={() => setOpenMonths((m) => ({ ...m, [k]: !isOpen(k, i) }))} style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: 10, cursor: "pointer", fontFamily: F.heading, fontSize: 14, fontWeight: 700, color: "#0f172a" }}>
            <span>📂 {monthLabel(k)}</span><span style={{ fontFamily: F.body, fontSize: 12, color: "#64748b" }}>{list.length} · {isOpen(k, i) ? "▾" : "▸"}</span>
          </button>
          {isOpen(k, i) && list.map((r) => (
            <div key={r.id} onClick={() => setOpenId(r.id)} style={{ ...S.itemCard, marginTop: 6, cursor: "pointer", borderLeft: `4px solid ${r.followUp ? "#DC2626" : r.frequency === "Repair" ? WARN : NAVY}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontFamily: F.heading, fontSize: 14, fontWeight: 700, color: "#0f172a", lineHeight: 1.3 }}>{r.frequency === "Repair" ? "🔧 Repair" : `📋 ${r.frequency} PM`} — {r.equipment}</div>
                  <div style={{ fontFamily: F.body, fontSize: 12, color: "#64748b", marginTop: 3 }}>{r.facility}</div>
                  <div style={{ fontFamily: F.body, fontSize: 11, color: "#94a3b8", marginTop: 2 }}>{r.technician} · {formatPmDate(r.pmDate)}{r.photos.length ? ` · 📷 ${r.photos.length}` : ""}</div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
                  {r.followUp && <span style={{ background: "#FEF2F2", color: "#DC2626", padding: "2px 8px", borderRadius: 4, fontFamily: F.body, fontSize: 10, fontWeight: 800 }}>⚠️ FOLLOW-UP</span>}
                  {!r.emailSentAt && !r.legacyPath && <span style={{ background: "#FEF3C7", color: "#b45309", padding: "2px 8px", borderRadius: 4, fontFamily: F.body, fontSize: 10, fontWeight: 700 }}>email pending</span>}
                  <span style={{ color: "#94a3b8", fontSize: 18 }}>›</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      ))}
      <div style={{ height: 80 }} />
    </div>
  );
}

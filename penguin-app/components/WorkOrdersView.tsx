"use client";
import { useEffect, useState } from "react";
import { WO_LOCATIONS, WO_PRIORITIES, WO_STATUSES, WO_TYPES, type Photo, type User, type WorkOrder } from "@/lib/types";
import { createWorkOrder, updateWorkOrder, deleteWorkOrder, addVisit, deleteVisit, removeWorkOrderPhoto, flash, pullFromSlack, slackPullDue, type WorkOrderInput, type VisitInput } from "@/lib/store";
import { parseHelpRequest, DEFAULT_LOCATION } from "@/lib/wo-parse";
import { PhotoGrid } from "./PhotoGrid";
import { Lightbox } from "./Lightbox";
import { S, F } from "./styles";

const STATUS_STYLE: Record<string, { bg: string; fg: string }> = {
  "Open": { bg: "#FEF3C7", fg: "#92400E" },
  "In Progress": { bg: "#DBEAFE", fg: "#1E40AF" },
  "Completed": { bg: "#D1FAE5", fg: "#065F46" },
  "On Hold": { bg: "#FEE2E2", fg: "#991B1B" },
};
const PRIORITY_COLOR: Record<string, string> = { Urgent: "#dc2626", High: "#ea580c", Normal: "#64748b", Low: "#94a3b8" };
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const totalHours = (wo: WorkOrder) => wo.visits.reduce((s, v) => s + (Number(v.hours) || 0), 0);

function Badge({ status }: { status: string }) {
  const st = STATUS_STYLE[status] || STATUS_STYLE.Open;
  return <span style={{ display: "inline-block", padding: "3px 9px", borderRadius: 6, fontSize: 10, fontWeight: 800, textTransform: "uppercase", background: st.bg, color: st.fg, fontFamily: F.body, whiteSpace: "nowrap" }}>{status}</span>;
}

// ── Bottom-sheet / modal wrapper ──
function Sheet({ title, onClose, children, footer }: { title: string; onClose: () => void; children: React.ReactNode; footer: React.ReactNode }) {
  return (
    <div className="pg-sheet-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="pg-sheet" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 18px", background: "#0f172a", color: "#fff" }}>
          <span style={{ fontFamily: F.heading, fontSize: 15, fontWeight: 700 }}>{title}</span>
          <button onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", color: "#fff", fontSize: 20, cursor: "pointer" }}>✕</button>
        </div>
        <div style={{ padding: "6px 18px 14px", overflowY: "auto", flex: 1 }}>{children}</div>
        <div style={{ padding: "12px 18px calc(12px + env(safe-area-inset-bottom, 0px))", borderTop: "1px solid #e2e8f0", display: "flex", gap: 8 }}>{footer}</div>
      </div>
    </div>
  );
}

// ── New / edit work order ──
function WorkOrderForm({ wo, onClose, initial, source = null, note }: { wo: WorkOrder | null; onClose: () => void; initial?: Partial<WorkOrderInput>; source?: string | null; note?: string }) {
  const [f, setF] = useState<WorkOrderInput>({
    title: wo?.title || initial?.title || "", location: wo?.location || initial?.location || WO_LOCATIONS[0], type: wo?.type || initial?.type || WO_TYPES[0],
    priority: wo?.priority || initial?.priority || "Normal", status: wo?.status || initial?.status || "Open", details: wo?.details || initial?.details || "",
  });
  const [newPhotos, setNewPhotos] = useState<Photo[]>([]);
  const [lightbox, setLightbox] = useState<Photo | null>(null);
  const set = <K extends keyof WorkOrderInput>(k: K, v: WorkOrderInput[K]) => setF((p) => ({ ...p, [k]: v }));
  const save = () => {
    if (!f.title.trim()) { flash("Please enter a title/description.", "err"); return; }
    if (wo) updateWorkOrder(wo.id, { ...f, title: f.title.trim(), details: f.details.trim() }, newPhotos);
    else createWorkOrder({ ...f, title: f.title.trim(), details: f.details.trim() }, newPhotos, source);
    onClose();
  };
  const sel = (label: string, key: "location" | "type" | "priority" | "status", opts: readonly string[]) => (
    <div>
      <label style={S.label}>{label}</label>
      <select style={{ ...S.select, width: "100%" }} value={f[key]} onChange={(e) => set(key, e.target.value)}>{opts.map((o) => <option key={o}>{o}</option>)}</select>
    </div>
  );
  return (
    <Sheet title={wo ? `Edit ${wo.woNumber || "Work Order"}` : "New Work Order"} onClose={onClose}
      footer={<><button style={S.btnSecondary} onClick={onClose}>Cancel</button><button style={{ ...S.btnPrimary, flex: 1 }} onClick={save}>Save</button></>}>
      {lightbox && <Lightbox src={lightbox.full} onClose={() => setLightbox(null)} />}
      {source === "slack-paste" && (
        <div style={{ background: "#F3E8FF", border: "1.5px solid #c4b5fd", borderRadius: 10, padding: "10px 12px", fontFamily: F.body, fontSize: 12, color: "#5b21b6", marginBottom: 4 }}>
          ⚡ Generated from the pasted Slack request — check the fields before saving.{note ? ` ${note}` : ""}
        </div>
      )}
      <label style={S.label}>Title / Description *</label>
      <input style={S.input} value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. AC not cooling in Studio B" autoFocus={!wo} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {sel("Location", "location", WO_LOCATIONS)}
        {sel("Type", "type", WO_TYPES)}
        {sel("Priority", "priority", WO_PRIORITIES)}
        {sel("Status", "status", WO_STATUSES)}
      </div>
      <label style={S.label}>Details / Notes</label>
      <textarea style={{ ...S.input, minHeight: 80, resize: "vertical" }} value={f.details} onChange={(e) => set("details", e.target.value)} placeholder="Describe the issue, equipment involved, etc." />
      <label style={S.label}>Photos{wo && wo.photos.length ? ` (${wo.photos.length} already attached)` : ""}</label>
      <PhotoGrid photos={newPhotos} onAdd={(p) => setNewPhotos((x) => [...x, ...p])} onRemove={(i) => setNewPhotos((x) => x.filter((_, j) => j !== i))} onOpen={setLightbox} />
    </Sheet>
  );
}

// ── Paste a Slack help request → generate a work order ──
function PasteSheet({ user, onClose, onGenerate }: { user: User; onClose: () => void; onGenerate: (initial: WorkOrderInput, note?: string) => void }) {
  const [text, setText] = useState("");
  const generate = () => {
    if (!text.trim()) { flash("Paste the Slack message first.", "err"); return; }
    const p = parseHelpRequest(text, user.displayName);
    onGenerate({ title: p.title, location: p.location, type: p.type, priority: p.priority, status: p.status, details: p.details },
      p.locationDefaulted ? `The text doesn't name a building, so it's set to ${DEFAULT_LOCATION} (904 is closed).` : undefined);
  };
  return (
    <Sheet title="⚡ Work Order from Slack" onClose={onClose}
      footer={<><button style={S.btnSecondary} onClick={onClose}>Cancel</button><button style={{ ...S.btnPrimary, flex: 1 }} onClick={generate}>Generate Work Order</button></>}>
      <p style={{ fontFamily: F.body, fontSize: 13, color: "#475569", margin: "0 0 10px", lineHeight: 1.5 }}>
        Copy the help request in Slack (long-press the message → Copy text), paste it below and tap <b>Generate</b>. The title, building (900/904), type and priority are filled in for you to check.
      </p>
      <textarea style={{ ...S.input, minHeight: 150, resize: "vertical" }} value={text} onChange={(e) => setText(e.target.value)} autoFocus
        placeholder={"Paste here… e.g.\nJohn Smith  10:32 AM\nAC is down in Studio B at 904, please look at it ASAP"} />
      <button type="button" style={{ ...S.btnLink, textAlign: "left", marginTop: 6, fontSize: 12 }} onClick={async () => {
        try { const t = await navigator.clipboard.readText(); if (t) setText(t); else flash("Clipboard is empty.", "err"); } catch { flash("Tap the box and paste instead — clipboard access was blocked.", "err"); }
      }}>📋 Paste from clipboard</button>
    </Sheet>
  );
}

// ── Log a visit ──
function VisitForm({ wo, user, onClose }: { wo: WorkOrder; user: User; onClose: () => void }) {
  const [f, setF] = useState<VisitInput>({ date: today(), tech: user.displayName, hours: 0, notes: "" });
  const [hoursText, setHoursText] = useState("");
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [lightbox, setLightbox] = useState<Photo | null>(null);
  const [markDone, setMarkDone] = useState(false);
  const save = () => {
    const hours = parseFloat(hoursText);
    if (isNaN(hours) || hours < 0) { flash("Please enter valid hours.", "err"); return; }
    addVisit(wo.id, { ...f, hours, tech: f.tech.trim(), notes: f.notes.trim() }, photos);
    if (markDone && wo.status !== "Completed") updateWorkOrder(wo.id, { status: "Completed" });
    onClose();
  };
  return (
    <Sheet title={`Log a Visit — ${wo.woNumber || "new WO"}`} onClose={onClose}
      footer={<><button style={S.btnSecondary} onClick={onClose}>Cancel</button><button style={{ ...S.btnPrimary, flex: 1 }} onClick={save}>Add Visit</button></>}>
      {lightbox && <Lightbox src={lightbox.full} onClose={() => setLightbox(null)} />}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div><label style={S.label}>Date</label><input type="date" style={S.input} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></div>
        <div><label style={S.label}>Hours Spent</label><input type="number" inputMode="decimal" step="0.25" min="0" style={S.input} value={hoursText} onChange={(e) => setHoursText(e.target.value)} placeholder="e.g. 2.5" autoFocus /></div>
      </div>
      <label style={S.label}>Technician(s)</label>
      <input style={S.input} value={f.tech} onChange={(e) => setF({ ...f, tech: e.target.value })} placeholder="Who went out" />
      <label style={S.label}>Work Done / Notes</label>
      <textarea style={{ ...S.input, minHeight: 80, resize: "vertical" }} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="What was done on this visit" />
      <label style={S.label}>Photos</label>
      <PhotoGrid photos={photos} onAdd={(p) => setPhotos((x) => [...x, ...p])} onRemove={(i) => setPhotos((x) => x.filter((_, j) => j !== i))} onOpen={setLightbox} />
      {wo.status !== "Completed" && (
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, fontFamily: F.body, fontSize: 13, color: "#334155", cursor: "pointer" }}>
          <input type="checkbox" checked={markDone} onChange={(e) => setMarkDone(e.target.checked)} /> Mark work order Completed
        </label>
      )}
    </Sheet>
  );
}

// ── Main view ──
export function WorkOrdersView({ workOrders, user, online = true }: { workOrders: WorkOrder[]; user: User; online?: boolean }) {
  const isAdmin = user.role === "admin";
  const [pulling, setPulling] = useState(false);
  // New Slack help requests are fetched when the screen opens (at most every 3 minutes).
  useEffect(() => { if (online && slackPullDue()) void pullFromSlack({ silent: true }); }, [online]);
  const pullNow = async () => { setPulling(true); try { await pullFromSlack(); } finally { setPulling(false); } };
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<string>("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editing, setEditing] = useState<WorkOrder | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [showPaste, setShowPaste] = useState(false);
  const [generated, setGenerated] = useState<{ initial: WorkOrderInput; note?: string } | null>(null);
  const [visitFor, setVisitFor] = useState<WorkOrder | null>(null);
  const [lightbox, setLightbox] = useState<Photo | null>(null);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);

  const q = search.toLowerCase().trim();
  const list = workOrders
    .filter((w) => filter === "all" ? true : filter === "active" ? w.status !== "Completed" : w.status === filter)
    .filter((w) => !q || [w.woNumber, w.title, w.location, w.type, w.details, w.createdBy].some((s) => (s || "").toLowerCase().includes(q)));
  const counts = (s: string) => workOrders.filter((w) => w.status === s).length;
  const chips: { key: string; label: string }[] = [
    { key: "all", label: `All (${workOrders.length})` },
    { key: "active", label: `Active (${workOrders.filter((w) => w.status !== "Completed").length})` },
    ...WO_STATUSES.map((s) => ({ key: s, label: `${s} (${counts(s)})` })),
  ];

  return (
    <div className="pg-page">
      {lightbox && <Lightbox src={lightbox.full} onClose={() => setLightbox(null)} />}
      {showNew && <WorkOrderForm wo={null} onClose={() => setShowNew(false)} />}
      {showPaste && <PasteSheet user={user} onClose={() => setShowPaste(false)} onGenerate={(initial, note) => { setShowPaste(false); setGenerated({ initial, note }); }} />}
      {generated && <WorkOrderForm wo={null} initial={generated.initial} note={generated.note} source="slack-paste" onClose={() => setGenerated(null)} />}
      {editing && <WorkOrderForm wo={editing} onClose={() => setEditing(null)} />}
      {visitFor && <VisitForm wo={visitFor} user={user} onClose={() => setVisitFor(null)} />}

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <h2 style={{ ...S.pageTitle, margin: 0, flex: 1 }}>🔧 Work Orders</h2>
        <button style={{ ...S.btnSecondary, whiteSpace: "nowrap", padding: "10px 12px", color: "#5b21b6", borderColor: "#c4b5fd", opacity: pulling || !online ? 0.6 : 1 }} disabled={pulling || !online} onClick={() => void pullNow()} title="Read #help-facilities now and import new HVAC / plumbing requests">{pulling ? "⏳ Slack…" : "🔄 Pull Slack"}</button>
        <button style={{ ...S.btnSecondary, whiteSpace: "nowrap", padding: "10px 12px", color: "#5b21b6", borderColor: "#c4b5fd" }} onClick={() => setShowPaste(true)} title="Paste a Slack help request and generate a work order">⚡ From Slack</button>
        <button style={{ ...S.btnPrimary, width: "auto", padding: "10px 16px" }} onClick={() => setShowNew(true)}>+ New</button>
      </div>
      <input style={S.input} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search WO#, title, location…" />
      <div style={{ display: "flex", gap: 6, margin: "10px 0 14px", flexWrap: "wrap" }}>
        {chips.map((c) => (
          <button key={c.key} onClick={() => setFilter(c.key)} style={{ padding: "6px 12px", border: "1.5px solid", borderColor: filter === c.key ? "#0f172a" : "#e2e8f0", borderRadius: 20, background: filter === c.key ? "#0f172a" : "#fff", color: filter === c.key ? "#fff" : "#64748b", fontFamily: F.body, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>{c.label}</button>
        ))}
      </div>

      {list.length === 0 && (
        <p style={{ fontFamily: F.body, fontSize: 13, color: "#94a3b8", textAlign: "center", padding: 40 }}>
          {workOrders.length ? "No work orders match your search." : "No work orders yet. Tap + New to create one."}
        </p>
      )}

      {list.map((wo) => {
        const open = expanded === wo.id;
        const hrs = totalHours(wo);
        return (
          <div key={wo.id} style={{ ...S.itemCard, padding: 0, overflow: "hidden", marginBottom: 10 }}>
            <div style={{ padding: "12px 14px", cursor: "pointer" }} onClick={() => setExpanded(open ? null : wo.id)}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: F.mono, fontSize: 12, fontWeight: 700, color: "#0d9488", display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                    {wo.woNumber || <span style={{ color: "#b45309" }}>WO-pending</span>}
                    {wo.source?.startsWith("slack") && <span style={{ background: "#4A154B", color: "#fff", padding: "1px 6px", borderRadius: 3, fontSize: 9, fontWeight: 700, textTransform: "uppercase", fontFamily: F.body }}>Slack</span>}
                    {wo.priority !== "Normal" && <span style={{ color: PRIORITY_COLOR[wo.priority] || "#64748b", fontSize: 10, fontFamily: F.body, fontWeight: 800, textTransform: "uppercase" }}>{wo.priority}</span>}
                  </div>
                  <div style={{ fontFamily: F.heading, fontSize: 15, fontWeight: 700, color: "#0f172a", marginTop: 2, lineHeight: 1.3 }}>{wo.title || "Untitled"}</div>
                  <div style={{ fontFamily: F.body, fontSize: 12, color: "#64748b", marginTop: 4 }}>{wo.location} · {wo.type}{wo.createdBy ? ` · ${wo.createdBy}` : ""}</div>
                </div>
                <Badge status={wo.status} />
              </div>
              <div style={{ display: "flex", gap: 14, marginTop: 8, fontFamily: F.body, fontSize: 12, color: "#64748b", flexWrap: "wrap" }}>
                <span>Visits: <b style={{ color: "#0f172a", fontSize: 14 }}>{wo.visits.length}</b></span>
                <span>Total Hours: <b style={{ color: "#0f172a", fontSize: 14 }}>{hrs.toFixed(2)}</b></span>
                <span>Created: {new Date(wo.createdAt).toLocaleDateString()}</span>
                {wo.photos.length > 0 && <span>📷 {wo.photos.length}</span>}
              </div>
            </div>

            {open && (
              <div style={{ padding: "0 14px 14px", borderTop: "1px solid #f1f5f9" }}>
                {wo.details && (<>
                  <div style={S.detailLabel}>Details</div>
                  <div style={{ fontFamily: F.body, fontSize: 14, color: "#1e293b", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{wo.details}</div>
                </>)}
                <div style={S.detailLabel}>Photos ({wo.photos.length})</div>
                <PhotoGrid photos={wo.photos} size={64} onOpen={setLightbox}
                  onAdd={(p) => updateWorkOrder(wo.id, {}, p)}
                  onRemove={isAdmin ? (i) => removeWorkOrderPhoto(wo.id, i) : undefined} />

                <div style={S.detailLabel}>Visit Log ({wo.visits.length})</div>
                {wo.visits.length === 0 && <div style={{ fontFamily: F.body, fontSize: 13, color: "#94a3b8" }}>No visits logged yet.</div>}
                {wo.visits.map((v) => (
                  <div key={v.id} style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: 10, marginTop: 6 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontFamily: F.body, fontSize: 12, fontWeight: 700, color: "#1e3a5c", gap: 8 }}>
                      <span>{v.date} · {v.tech}</span><span>{Number(v.hours) || 0} hrs</span>
                    </div>
                    {v.notes && <div style={{ fontFamily: F.body, fontSize: 13, color: "#475569", marginTop: 4, whiteSpace: "pre-wrap" }}>{v.notes}</div>}
                    {v.photos.length > 0 && <PhotoGrid photos={v.photos} size={54} onOpen={setLightbox} />}
                    {(isAdmin || v.loggedBy === user.displayName) && (
                      <button style={{ ...S.btnLink, textAlign: "left", marginTop: 6, fontSize: 12, color: "#ef4444", width: "auto" }} onClick={() => { if (confirm("Remove this visit?")) deleteVisit(wo.id, v.id); }}>Remove visit</button>
                    )}
                  </div>
                ))}

                <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                  <button style={{ ...S.btnPrimary, flex: 1, minWidth: 120 }} onClick={() => setVisitFor(wo)}>+ Log Visit</button>
                  <button style={{ ...S.btnSecondary, flex: 1 }} onClick={() => setEditing(wo)}>Edit</button>
                  {wo.status !== "Completed"
                    ? <button style={{ ...S.btnSecondary, flex: 1, color: "#065F46", borderColor: "#86efac" }} onClick={() => updateWorkOrder(wo.id, { status: "Completed" })}>✓ Complete</button>
                    : <button style={{ ...S.btnSecondary, flex: 1 }} onClick={() => updateWorkOrder(wo.id, { status: "Open" })}>Reopen</button>}
                  {isAdmin && confirmDel !== wo.id && <button style={{ ...S.btnDel, flex: 1 }} onClick={() => setConfirmDel(wo.id)}>Delete</button>}
                  {isAdmin && confirmDel === wo.id && (<>
                    <button style={{ ...S.btnDel, flex: 1 }} onClick={() => { deleteWorkOrder(wo.id); setConfirmDel(null); setExpanded(null); }}>Yes, delete {wo.woNumber || ""}</button>
                    <button style={S.btnSecondary} onClick={() => setConfirmDel(null)}>Cancel</button>
                  </>)}
                </div>
              </div>
            )}
          </div>
        );
      })}
      <div style={{ height: 80 }} />
    </div>
  );
}

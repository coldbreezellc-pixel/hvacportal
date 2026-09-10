"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { User } from "@/lib/types";
import { flash, setView, submitPm, PM_REPORT_RECIPIENTS_TEXT as REPORT_RECIPIENTS } from "@/lib/store";
import { resizePhoto } from "@/lib/images";
import { FACILITIES, FREQUENCIES, SAFETY_SECTIONS, POSTJOB_TASKS, EMERGENCY_PROCEDURES, type Frequency } from "@/lib/pm/data";
import { buildBlocks, equipmentForFacility, equipmentList, isMultiUnit, type BlockDef } from "@/lib/pm/checklists";
import { emptyPmForm, formatPmDate, today, type CheckState, type PhotoSlot, type PmFormState, type PmRecord, type SafetyRow, type ChecklistBlock } from "@/lib/pm/types";
import { buildPdf, emailSubjectFor } from "@/lib/pm/report";
import { loadPmDraft, savePmDraft, clearPmDraft, draftHasContent } from "@/lib/pm/draft";
import { SignaturePad } from "./SignaturePad";
import { Lightbox } from "../Lightbox";
import { S, F } from "../styles";

const NAVY = "#1B3A5C", WARN = "#E65100", SAFETY = "#2E7D32";

// ── small building blocks ──
const Section = ({ icon, title, color = NAVY, children }: { icon: string; title: string; color?: string; children: React.ReactNode }) => (
  <div style={{ ...S.card, padding: 0, overflow: "hidden" }}>
    <div style={{ background: color, color: "#fff", padding: "11px 16px", fontFamily: F.heading, fontSize: 14, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}><span>{icon}</span>{title}</div>
    <div style={{ padding: 16 }}>{children}</div>
  </div>
);
const SubHeader = ({ children }: { children: React.ReactNode }) => (
  <div style={{ fontFamily: F.body, fontSize: 12, fontWeight: 800, color: NAVY, textTransform: "uppercase", letterSpacing: 0.5, margin: "14px 0 6px", paddingBottom: 4, borderBottom: "2px solid #e2e8f0" }}>{children}</div>
);

function CheckRow({ label, state, onChange }: { label: string; state: CheckState; onChange: (s: CheckState) => void }) {
  const btn = (kind: "done" | "na") => {
    const active = state === kind;
    return (
      <button type="button" onClick={() => onChange(active ? null : kind)} aria-pressed={active}
        style={{ minWidth: kind === "done" ? 44 : 48, height: 34, borderRadius: 8, border: "1.5px solid", fontFamily: F.body, fontSize: 12, fontWeight: 800, cursor: "pointer",
          borderColor: active ? (kind === "done" ? SAFETY : "#94a3b8") : "#e2e8f0", background: active ? (kind === "done" ? SAFETY : "#94a3b8") : "#fff", color: active ? "#fff" : "#64748b" }}>
        {kind === "done" ? "✓" : "N/A"}
      </button>
    );
  };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", borderBottom: "1px solid #f1f5f9" }}>
      <div style={{ flex: 1, fontFamily: F.body, fontSize: 13, color: "#1e293b", textDecoration: state === "na" ? "line-through" : "none", opacity: state === "na" ? 0.6 : 1 }}>{label}</div>
      {btn("done")}{btn("na")}
    </div>
  );
}

function PhotoSlots({ slots, onChange, onOpen, accent = NAVY, label = "Tap to Add Photo" }: { slots: PhotoSlot[]; onChange: (s: PhotoSlot[]) => void; onOpen: (src: string) => void; accent?: string; label?: string }) {
  const update = (id: number, patch: Partial<PhotoSlot>) => onChange(slots.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const pick = async (id: number, file: File | undefined) => {
    if (!file) return;
    try { const r = await resizePhoto(file); update(id, { dataUrl: r.full }); } catch { flash("Could not read that photo.", "err"); }
  };
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
      {slots.map((s, i) => (
        <div key={s.id}>
          <div style={{ position: "relative", aspectRatio: "4 / 3", borderRadius: 10, border: `1.5px dashed ${s.dataUrl ? accent : "#cbd5e1"}`, background: "#f8fafc", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
            {s.dataUrl ? (
              <img src={s.dataUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", cursor: "zoom-in" }} onClick={() => onOpen(s.dataUrl!)} />
            ) : (
              <label style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", cursor: "pointer", fontFamily: F.body, color: "#64748b", fontSize: 12, gap: 2 }}>
                <span style={{ fontSize: 26 }}>📷</span><b>{label}</b><span style={{ fontSize: 10 }}>Camera or Gallery</span>
                <input type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={(e) => { void pick(s.id, e.target.files?.[0]); e.target.value = ""; }} />
              </label>
            )}
            <span style={{ position: "absolute", top: 6, left: 6, background: accent, color: "#fff", fontFamily: F.mono, fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 8 }}>{i + 1}</span>
            {s.dataUrl && <button type="button" aria-label="Remove photo" onClick={() => update(s.id, { dataUrl: null })} style={{ position: "absolute", top: 4, right: 4, width: 24, height: 24, borderRadius: "50%", border: "none", background: "rgba(220,38,38,.9)", color: "#fff", cursor: "pointer", fontSize: 12 }}>✕</button>}
          </div>
          <input style={{ ...S.input, marginTop: 6, padding: "8px 10px", fontSize: 13 }} value={s.caption} onChange={(e) => update(s.id, { caption: e.target.value })} placeholder="Caption…" />
        </div>
      ))}
    </div>
  );
}

const Chip = ({ active, onClick, children, color = "#2979FF" }: { active: boolean; onClick: () => void; children: React.ReactNode; color?: string }) => (
  <button type="button" onClick={onClick} style={{ padding: "8px 14px", borderRadius: 20, border: "1.5px solid", borderColor: active ? color : "#e2e8f0", background: active ? color + "18" : "#fafbfd", color: active ? color : "#334155", fontFamily: F.body, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>{active ? "✓ " : ""}{children}</button>
);

// ═══════════════════════════════════════════════════════════════════════════
export function PmSheetView({ user, online, records }: { user: User; online: boolean; records: PmRecord[] }) {
  const [form, setForm] = useState<PmFormState>(() => emptyPmForm(REPORT_RECIPIENTS));
  const [draftBanner, setDraftBanner] = useState<PmFormState | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [techInput, setTechInput] = useState("");
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const lastSaved = useRef<string>("");

  const patch = useCallback((p: Partial<PmFormState> | ((f: PmFormState) => Partial<PmFormState>)) =>
    setForm((f) => ({ ...f, ...(typeof p === "function" ? p(f) : p) })), []);

  // ── draft: load once, autosave (debounced) ──
  useEffect(() => {
    void loadPmDraft().then((d) => { if (d && draftHasContent(d)) setDraftBanner(d); setLoaded(true); });
  }, []);
  useEffect(() => {
    if (!loaded) return;
    const t = setTimeout(() => {
      const snapshot = JSON.stringify(form);
      if (snapshot === lastSaved.current) return;
      lastSaved.current = snapshot;
      if (draftHasContent(form)) void savePmDraft({ ...form, savedAt: new Date().toISOString(), savedBy: user.displayName });
    }, 800);
    return () => clearTimeout(t);
  }, [form, loaded, user.displayName]);

  // ── derived ──
  const equipment = useMemo(() => equipmentForFacility(form.facility), [form.facility]);
  const blocks: BlockDef[] = useMemo(() => buildBlocks(form), [form]);
  const safetyUnchecked = useMemo(() => {
    const out: string[] = [];
    SAFETY_SECTIONS.forEach((sec) => sec.items.forEach((item, i) => { if (!form.safetyChecks[`${sec.key}|${i}`]) out.push(item); }));
    return out;
  }, [form.safetyChecks]);
  const hasLoto = form.lotoPhotos.some((p) => p.dataUrl);
  const allSafetySigned = form.techNames.length > 0 && form.techNames.every((n) => form.safetySigs[n]?.signed);
  const safetyReady = form.techNames.length > 0 && safetyUnchecked.length === 0 && hasLoto && allSafetySigned;
  const safetyStatus = form.techNames.length === 0 ? "Add technician name(s) first" : safetyReady ? "✓ All Signed — Continue to PM" : [
    safetyUnchecked.length ? `${safetyUnchecked.length} checklist items incomplete` : null,
    !hasLoto ? "LOTO photo required" : null,
    !allSafetySigned ? `${form.techNames.filter((n) => form.safetySigs[n]?.signed).length}/${form.techNames.length} signed` : null,
  ].filter(Boolean).join(" · ");

  // ── technicians ──
  const addTech = (name: string) => {
    const c = name.replace(/,/g, "").trim();
    if (!c || form.techNames.includes(c)) return;
    patch((f) => ({ techNames: [...f.techNames, c] }));
  };
  const removeTech = (i: number) => patch((f) => {
    const name = f.techNames[i]; const techNames = f.techNames.filter((_, j) => j !== i);
    const { [name]: _a, ...safetySigs } = f.safetySigs; const { [name]: _b, ...compSigs } = f.compSigs; void _a; void _b;
    return { techNames, safetySigs, compSigs };
  });

  // ── equipment ──
  const toggleEquip = (name: string) => patch((f) => {
    const on = f.selectedEquip.includes(name);
    const selectedEquip = on ? f.selectedEquip.filter((n) => n !== name) : [...f.selectedEquip, name];
    let liebertUnits = f.liebertUnits; const equipUnits = { ...f.equipUnits };
    if (name === "Liebert Unit") liebertUnits = on ? [] : (f.liebertUnits.length ? f.liebertUnits : [{ id: Date.now(), num: "" }]);
    if (isMultiUnit(name)) { if (on) delete equipUnits[name]; else if (!equipUnits[name]?.length) equipUnits[name] = [{ id: Date.now(), num: "" }]; }
    return { selectedEquip, liebertUnits, equipUnits };
  });
  const setFacility = (facility: string) => patch((f) => {
    const valid = new Set(Object.values(equipmentForFacility(facility)).flat());
    const selectedEquip = f.selectedEquip.filter((n) => valid.has(n));
    const equipUnits = Object.fromEntries(Object.entries(f.equipUnits).filter(([n]) => valid.has(n)));
    return { facility, selectedEquip, equipUnits, liebertUnits: valid.has("Liebert Unit") ? f.liebertUnits : [] };
  });

  // ── submit ──
  const validate = (): string | null => {
    if (!form.facility) return "Please select a facility.";
    if (!form.techNames.length) return "Please add at least one technician name.";
    if (!form.ppeAcknowledgedAt) return "You must acknowledge the PPE requirement.";
    if (!form.safetyCompleted) return "Please complete the Safety Checklist.";
    if (!form.selectedEquip.length) return "Please select at least one piece of equipment.";
    if (form.selectedEquip.includes("Liebert Unit")) {
      if (!form.liebertUnits.length) return "Please add at least one Liebert Unit #.";
      if (form.liebertUnits.some((u) => !u.num.trim())) return "Please fill in all Liebert Unit numbers.";
    }
    for (const n of form.selectedEquip.filter(isMultiUnit)) {
      const units = form.equipUnits[n] || [];
      if (!units.length) return `Please add at least one Unit # for ${n}.`;
      if (units.some((u) => !u.num.trim())) return `Please fill in all Unit # for ${n}.`;
    }
    if (form.followUp && !form.summaryNotes.trim()) return "Follow-up is required. Please describe what needs to be followed up in the Summary Notes field.";
    const unsigned = form.techNames.filter((n) => !form.compSigs[n]?.signed);
    if (unsigned.length) return `All technicians must sign before submitting. Still need signatures from: ${unsigned.join(", ")}`;
    if (!form.emailTo.trim()) return "Add at least one email recipient.";
    return null;
  };

  const buildRecord = (): PmRecord => {
    const id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now());
    const safetyData: SafetyRow[][] = SAFETY_SECTIONS.map((sec) => sec.items.map((task, i) => { const st = form.safetyChecks[`${sec.key}|${i}`]; return { task, done: st === "done", na: st === "na", condition: "" }; }));
    const postJobData: SafetyRow[] = POSTJOB_TASKS.map((task, i) => { const st = form.postJobChecks[String(i)]; return { task, done: st === "done", na: st === "na" }; });
    const checklistData: ChecklistBlock[] = blocks.map((b) => {
      const readings: Record<string, string> = {};
      b.parts.forEach((p) => { if (p.t === "readings") p.labels.forEach((l) => { const v = form.readings[`${b.key}|${l}`]; if (v) readings[l] = v; }); });
      return {
        header: b.header,
        tasks: b.parts.filter((p) => p.t === "task").map((p) => ({ text: `${(p as { idx: number }).idx + 1}. ${(p as { text: string }).text}`, done: !!form.taskChecks[`${b.key}|${(p as { idx: number }).idx}`] })),
        findings: form.findings[b.key] || "",
        ...(Object.keys(readings).length ? { readings } : {}),
      };
    });
    const photos = [
      ...form.lotoPhotos.filter((p) => p.dataUrl).map((p, i) => ({ caption: p.caption || `LOTO Photo ${i + 1}`, url: p.dataUrl!, kind: "loto" as const })),
      ...form.photos.filter((p) => p.dataUrl).map((p, i) => ({ caption: p.caption || `Photo ${i + 1}`, url: p.dataUrl!, kind: "photo" as const })),
    ];
    const signatureData = [
      ...form.techNames.filter((n) => form.safetySigs[n]?.dataUrl).map((n) => ({ type: "safety" as const, name: n, url: form.safetySigs[n].dataUrl! })),
      ...form.techNames.filter((n) => form.compSigs[n]?.dataUrl).map((n) => ({ type: "completion" as const, name: n, url: form.compSigs[n].dataUrl! })),
    ];
    const rec: PmRecord = {
      id, pmDate: form.date || today(), facility: form.facility, technician: form.techNames.join(", "), technicians: form.techNames,
      equipment: equipmentList(form).join(", "), frequency: form.freq, followUp: form.followUp, followUpNotes: form.summaryNotes.trim(),
      tasksCompleted: form.tasksCompleted.trim(), generalComments: form.generalComments.trim(), safetyData, postJobData, checklistData,
      signatureData, photos, pdfUrl: null, emailSubject: null, emailTo: form.emailTo.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean),
      emailSentAt: null, createdBy: user.displayName, legacyPath: null, createdAt: new Date().toISOString(),
    };
    rec.emailSubject = emailSubjectFor(rec);
    return rec;
  };

  const submit = async () => {
    const err = validate();
    if (err) { flash(err, "err"); return; }
    setBusy("Preparing report…");
    try {
      const record = buildRecord();
      setBusy("Building PDF…");
      let pdf: string | null = null;
      try { pdf = await buildPdf(record); } catch (e) { console.error("PDF failed", e); }
      setBusy(online ? "Saving & emailing…" : "Saving for upload…");
      submitPm(record, pdf);
      await clearPmDraft();
      lastSaved.current = "";
      setForm(emptyPmForm(REPORT_RECIPIENTS));
      setView("pmrecords");
    } finally { setBusy(null); }
  };

  const unitList = (units: { id: number; num: string }[], onChange: (u: { id: number; num: string }[]) => void, label: string) => (
    <div style={{ border: "1.5px dashed #cbd5e1", borderRadius: 10, padding: 12, marginTop: 10, background: "#fafbfd" }}>
      <div style={{ fontFamily: F.body, fontSize: 12, fontWeight: 800, color: NAVY, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>{label}</div>
      {units.map((u, i) => (
        <div key={u.id} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <span style={{ fontFamily: F.body, fontSize: 12, color: "#64748b", whiteSpace: "nowrap" }}>Unit #{i + 1}</span>
          <input style={{ ...S.input, padding: "8px 10px" }} value={u.num} onChange={(e) => onChange(units.map((x) => (x.id === u.id ? { ...x, num: e.target.value } : x)))} placeholder="Enter unit number…" />
          <button type="button" onClick={() => onChange(units.filter((x) => x.id !== u.id))} style={{ ...S.btnDel, padding: "8px 10px" }}>✕</button>
        </div>
      ))}
      <button type="button" style={{ ...S.btnSecondary, width: "100%" }} onClick={() => onChange([...units, { id: Date.now() + Math.random(), num: "" }])}>+ Add Another Unit</button>
    </div>
  );

  if (!loaded) return <div className="pg-page pg-page--narrow"><p style={{ fontFamily: F.body, color: "#64748b" }}>Loading…</p></div>;

  return (
    <div className="pg-page pg-page--narrow">
      {lightbox && <Lightbox src={lightbox} onClose={() => setLightbox(null)} />}
      {busy && (
        <div style={{ position: "fixed", inset: 0, zIndex: 400, background: "rgba(15,23,42,.7)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14 }}>
          <div style={S.spinner} /><p style={{ fontFamily: F.body, color: "#fff", fontWeight: 600 }}>{busy}</p>
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, gap: 8 }}>
        <h2 style={{ ...S.pageTitle, margin: 0 }}>📋 PM Sheet</h2>
        <button style={{ ...S.btnSecondary, whiteSpace: "nowrap" }} onClick={() => setView("pmrecords")}>📁 PM Records <span style={{ background: "#E8F0FE", color: "#2979FF", padding: "1px 8px", borderRadius: 10, fontSize: 11, fontWeight: 700 }}>{records.length}</span></button>
      </div>

      {draftBanner && (
        <div style={{ background: "#FEF3C7", border: "2px solid #F59E0B", borderRadius: 12, padding: 14, marginBottom: 14, textAlign: "center" }}>
          <div style={{ fontFamily: F.body, fontSize: 14, fontWeight: 800, color: "#92400E" }}>📝 Unsaved Draft Found</div>
          <div style={{ fontFamily: F.body, fontSize: 12, color: "#A16207", margin: "4px 0 10px" }}>
            {draftBanner.facility || "No facility"} · {draftBanner.techNames.join(", ") || "no techs"} · saved {draftBanner.savedAt ? new Date(draftBanner.savedAt).toLocaleString() : ""}{draftBanner.savedBy ? ` by ${draftBanner.savedBy}` : ""}
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
            <button style={{ ...S.btnPrimary, width: "auto", background: "#F59E0B" }} onClick={() => { setForm(draftBanner); setDraftBanner(null); }}>Resume Draft</button>
            <button style={S.btnSecondary} onClick={() => { void clearPmDraft(); setDraftBanner(null); }}>Start Fresh</button>
          </div>
        </div>
      )}

      {/* ── Work Order Information ── */}
      <Section icon="📋" title="Work Order Information">
        <label style={S.label}>Date</label>
        <input type="date" style={S.input} value={form.date} onChange={(e) => patch({ date: e.target.value })} />
        <label style={S.label}>Facility / Location</label>
        <select style={{ ...S.select, width: "100%" }} value={form.facility} onChange={(e) => setFacility(e.target.value)}>
          <option value="" disabled>Select facility…</option>
          {FACILITIES.map((f) => <option key={f}>{f}</option>)}
        </select>
        <label style={S.label}>Technician(s)</label>
        <div style={{ border: "1.5px solid #e2e8f0", borderRadius: 10, background: "#fff", padding: "6px 8px", display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", minHeight: 44 }}>
          {form.techNames.map((n, i) => (
            <span key={n} style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "#E8F0FE", border: "1px solid #bfdbfe", borderRadius: 6, padding: "4px 8px", fontFamily: F.body, fontSize: 13, fontWeight: 600, color: "#1e40af" }}>
              {n}<button type="button" onClick={() => removeTech(i)} style={{ border: "none", background: "rgba(30,64,175,.15)", color: "#1e40af", borderRadius: "50%", width: 18, height: 18, cursor: "pointer", fontSize: 11 }}>✕</button>
            </span>
          ))}
          <input value={techInput} onChange={(e) => setTechInput(e.target.value)} placeholder={form.techNames.length ? "Add another…" : "Type name, tap + to add"}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTech(techInput); setTechInput(""); } if (e.key === "Backspace" && !techInput && form.techNames.length) removeTech(form.techNames.length - 1); }}
            onBlur={() => { if (techInput.trim()) { addTech(techInput); setTechInput(""); } }}
            style={{ border: "none", outline: "none", background: "transparent", fontFamily: F.body, fontSize: 14, flex: 1, minWidth: 110, padding: "4px 0" }} autoCapitalize="words" enterKeyHint="done" />
          <button type="button" onClick={() => { addTech(techInput); setTechInput(""); }} style={{ padding: "6px 14px", border: "none", borderRadius: 6, background: "#2979FF", color: "#fff", fontSize: 16, fontWeight: 700, cursor: "pointer" }}>+</button>
        </div>
        {form.techNames.length > 0 && (
          <div style={{ marginTop: 6, fontFamily: F.body, fontSize: 12, color: "#64748b" }}>Tap yourself in quickly: {!form.techNames.includes(user.displayName) && <button type="button" style={{ ...S.btnLink, display: "inline", width: "auto", margin: 0, fontSize: 12 }} onClick={() => addTech(user.displayName)}>+ {user.displayName}</button>}</div>
        )}
        {form.techNames.length === 0 && <button type="button" style={{ ...S.btnLink, textAlign: "left", marginTop: 6, fontSize: 12 }} onClick={() => addTech(user.displayName)}>+ Add me ({user.displayName})</button>}

        {/* PPE banner */}
        <div style={{ marginTop: 16, background: form.ppeAcknowledgedAt ? "#E8F5E9" : "#FFEBEE", border: `2px solid ${form.ppeAcknowledgedAt ? "#A5D6A7" : "#EF9A9A"}`, borderRadius: 12, padding: 14, textAlign: "center" }}>
          <div style={{ fontSize: 28 }}>{form.ppeAcknowledgedAt ? "✅" : "🛑"}</div>
          <div style={{ fontFamily: F.heading, fontSize: 14, fontWeight: 800, color: form.ppeAcknowledgedAt ? SAFETY : "#C62828", margin: "6px 0 10px" }}>MAKE SURE TO USE PROPER PPE AT ALL TIMES</div>
          {form.ppeAcknowledgedAt ? (
            <div style={{ fontFamily: F.body, fontSize: 12, color: SAFETY, fontWeight: 600 }}>PPE Acknowledged at {new Date(form.ppeAcknowledgedAt).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}{form.techNames.length ? ` by ${form.techNames.join(", ")}` : ""}</div>
          ) : (
            <button type="button" style={{ ...S.btnPrimary, background: "#C62828" }} onClick={() => patch({ ppeAcknowledgedAt: new Date().toISOString() })}>I acknowledge that without PROPER PPE I cannot perform this PM</button>
          )}
        </div>
      </Section>

      {/* ── Safety Checklist (gated by PPE) ── */}
      {form.ppeAcknowledgedAt && (
        <Section icon="🦺" title="HVAC Safety Checklist" color={SAFETY}>
          {SAFETY_SECTIONS.map((sec) => (
            <div key={sec.key}>
              <SubHeader>{sec.label}</SubHeader>
              {sec.items.map((item, i) => (
                <CheckRow key={item} label={item} state={form.safetyChecks[`${sec.key}|${i}`] ?? null}
                  onChange={(s) => patch((f) => ({ safetyChecks: { ...f.safetyChecks, [`${sec.key}|${i}`]: s } }))} />
              ))}
              {sec.key === "electrical" && (
                <div style={{ margin: "14px 0 4px", padding: 14, background: "#FFF8E1", border: "1.5px solid #FFE082", borderRadius: 10 }}>
                  <div style={{ fontFamily: F.body, fontSize: 12, fontWeight: 800, color: WARN, textTransform: "uppercase", letterSpacing: 0.5 }}>📸 Lockout/Tagout Photo Documentation</div>
                  <p style={{ fontFamily: F.body, fontSize: 12, color: "#64748b", margin: "4px 0 10px" }}>Take photos of LOTO locks, tags, and equipment lockout points. At least one is required before signing.</p>
                  <PhotoSlots slots={form.lotoPhotos} onChange={(lotoPhotos) => patch({ lotoPhotos })} onOpen={setLightbox} accent={WARN} label="Add LOTO Photo" />
                  <button type="button" style={{ ...S.btnSecondary, width: "100%", marginTop: 10, borderStyle: "dashed", borderColor: "#FFE082", color: WARN, background: "transparent" }}
                    onClick={() => patch((f) => ({ lotoPhotos: [...f.lotoPhotos, { id: Date.now(), dataUrl: null, caption: "" }] }))}>+ Add LOTO Photo</button>
                </div>
              )}
            </div>
          ))}
          <SubHeader>Emergency Procedures</SubHeader>
          <ul style={{ margin: "0 0 0 18px", padding: 0, fontFamily: F.body, fontSize: 12, color: "#334155", lineHeight: 1.5 }}>
            {EMERGENCY_PROCEDURES.map((p) => <li key={p.title}><b>{p.title}:</b> {p.text}</li>)}
          </ul>

          <SubHeader>Technician Safety Signatures</SubHeader>
          <p style={{ fontFamily: F.body, fontSize: 12, color: "#64748b", margin: "0 0 10px" }}>Each technician must sign below to confirm they have reviewed the safety checklist.</p>
          {form.techNames.length === 0 && <p style={{ fontFamily: F.body, fontSize: 13, color: "#94a3b8", textAlign: "center", padding: 12 }}>Add technician name(s) above to generate signature fields.</p>}
          {form.techNames.map((name) => {
            const sig = form.safetySigs[name] || { dataUrl: null, signed: false };
            return (
              <div key={name} style={{ border: `1.5px solid ${sig.signed ? "#A5D6A7" : "#e2e8f0"}`, borderRadius: 10, padding: 12, marginBottom: 10, background: sig.signed ? "#F1F8E9" : "#fff" }}>
                <div style={{ fontFamily: F.body, fontSize: 13, fontWeight: 700, color: NAVY, marginBottom: 8 }}>✍️ {name}</div>
                <SignaturePad value={sig.dataUrl} disabled={sig.signed} onChange={(dataUrl) => patch((f) => ({ safetySigs: { ...f.safetySigs, [name]: { dataUrl, signed: false } } }))} />
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <button type="button" style={{ ...S.btnPrimary, flex: 1, background: sig.signed ? SAFETY : NAVY }} onClick={() => {
                    if (safetyUnchecked.length) { flash(`All safety checklist items must be marked Done or N/A before signing. Incomplete: ${safetyUnchecked.slice(0, 3).join("; ")}${safetyUnchecked.length > 3 ? ` and ${safetyUnchecked.length - 3} more` : ""}`, "err"); return; }
                    if (!hasLoto) { flash("At least one LOTO (Lockout/Tagout) photo must be added before signing.", "err"); return; }
                    if (!sig.dataUrl) { flash("Please sign above before confirming.", "err"); return; }
                    patch((f) => ({ safetySigs: { ...f.safetySigs, [name]: { ...sig, signed: true } } }));
                  }}>{sig.signed ? "✓ SIGNED" : "TAP TO CONFIRM SIGNATURE"}</button>
                  <button type="button" style={S.btnSecondary} onClick={() => patch((f) => ({ safetySigs: { ...f.safetySigs, [name]: { dataUrl: null, signed: false } }, safetyCompleted: false }))}>Clear</button>
                </div>
              </div>
            );
          })}
          <button type="button" disabled={!safetyReady} style={{ ...S.btnPrimary, marginTop: 6, background: safetyReady ? SAFETY : "#94a3b8", cursor: safetyReady ? "pointer" : "not-allowed" }}
            onClick={() => { patch({ safetyCompleted: true }); setTimeout(() => document.getElementById("pm-details")?.scrollIntoView({ behavior: "smooth", block: "start" }), 100); }}>
            {form.safetyCompleted ? "✓ Safety Checklist Complete" : safetyStatus}
          </button>
        </Section>
      )}

      {/* ── PM Details (gated by safety) ── */}
      {form.safetyCompleted && (
        <div id="pm-details">
          <Section icon="📋" title="PM Details">
            <label style={S.label}>Service Interval</label>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {FREQUENCIES.map((fq) => <Chip key={fq} active={form.freq === fq} onClick={() => patch({ freq: fq as Frequency })}>{fq}</Chip>)}
            </div>
            <label style={S.label}>Equipment (tap to select multiple)</label>
            {!Object.keys(equipment).length && <p style={{ fontFamily: F.body, fontSize: 13, color: "#94a3b8" }}>Select a facility above to see available equipment.</p>}
            {Object.entries(equipment).map(([group, items]) => (
              <div key={group} style={{ marginBottom: 10 }}>
                <div style={{ fontFamily: F.body, fontSize: 11, fontWeight: 800, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, margin: "8px 0 6px" }}>{group}</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {items.map((n) => <Chip key={n} active={form.selectedEquip.includes(n)} onClick={() => toggleEquip(n)}>{n}</Chip>)}
                </div>
              </div>
            ))}
            {form.selectedEquip.includes("Liebert Unit") && unitList(form.liebertUnits, (liebertUnits) => patch({ liebertUnits }), "Liebert Unit Numbers")}
            {form.selectedEquip.filter(isMultiUnit).map((n) => (
              <div key={n}>{unitList(form.equipUnits[n] || [], (units) => patch((f) => ({ equipUnits: { ...f.equipUnits, [n]: units } })), `${n} — Unit Numbers`)}</div>
            ))}
          </Section>

          {/* ── PM Checklist ── */}
          {blocks.length > 0 && (
            <Section icon="🔧" title="PM Checklist">
              <div style={{ background: "#FFEBEE", color: "#C62828", border: "1.5px solid #EF9A9A", borderRadius: 8, padding: 10, fontFamily: F.body, fontSize: 12, fontWeight: 800, textAlign: "center", marginBottom: 12 }}>⚠️ MAKE SURE TO USE PROPER PPE AT ALL TIMES</div>
              {blocks.map((b) => (
                <div key={b.key} style={{ border: "1.5px solid #e2e8f0", borderRadius: 10, marginBottom: 12, overflow: "hidden" }}>
                  <div style={{ background: b.style === "liebert" ? "#00897B" : b.style === "pump" ? "#5E35B1" : NAVY, color: "#fff", padding: "9px 12px", fontFamily: F.heading, fontSize: 13, fontWeight: 700 }}>{b.header}</div>
                  <div style={{ padding: "8px 12px 12px" }}>
                    {b.parts.map((p, i) => {
                      if (p.t === "freq") return <div key={i} style={{ fontFamily: F.body, fontSize: 11, fontWeight: 800, color: "#2979FF", textTransform: "uppercase", letterSpacing: 0.5, margin: "10px 0 4px" }}>{p.text}</div>;
                      if (p.t === "sub") return <div key={i} style={{ fontFamily: F.body, fontSize: 12, fontWeight: 700, color: "#00897B", margin: "8px 0 2px" }}>{p.text}</div>;
                      if (p.t === "note") return <div key={i} style={{ fontFamily: F.body, fontSize: 12, color: "#64748b", fontStyle: "italic", margin: "2px 0 6px" }}>{p.text}</div>;
                      if (p.t === "alert") return <div key={i} style={{ fontFamily: F.body, fontSize: 12, fontWeight: 700, color: "#C62828", background: "#FFEBEE", borderRadius: 6, padding: "6px 8px", margin: "6px 0" }}>{p.text}</div>;
                      if (p.t === "readings") return (
                        <div key={i} style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(p.labels.length, 3)}, 1fr)`, gap: 8, margin: "6px 0" }}>
                          {p.labels.map((l) => (
                            <div key={l}><label style={{ ...S.label, marginTop: 4, fontSize: 11 }}>{l}</label>
                              <input style={{ ...S.input, padding: "8px" }} inputMode="decimal" placeholder="—" value={form.readings[`${b.key}|${l}`] || ""} onChange={(e) => patch((f) => ({ readings: { ...f.readings, [`${b.key}|${l}`]: e.target.value } }))} /></div>
                          ))}
                        </div>
                      );
                      const k = `${b.key}|${p.idx}`; const done = !!form.taskChecks[k];
                      return (
                        <div key={i} onClick={() => patch((f) => ({ taskChecks: { ...f.taskChecks, [k]: !done } }))} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "7px 0", borderBottom: "1px solid #f1f5f9", cursor: "pointer" }}>
                          <div style={{ width: 24, height: 24, borderRadius: 6, border: `2px solid ${done ? SAFETY : "#cbd5e1"}`, background: done ? SAFETY : "#fff", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0 }}>{done ? "✓" : ""}</div>
                          <div style={{ fontFamily: F.body, fontSize: 13, color: done ? "#64748b" : "#1e293b", textDecoration: done ? "line-through" : "none", lineHeight: 1.4 }}>{p.idx + 1}. {p.text}</div>
                        </div>
                      );
                    })}
                    <label style={{ ...S.label, color: "#2979FF", textTransform: "uppercase", fontSize: 11 }}>Findings</label>
                    <textarea style={{ ...S.input, minHeight: 60, resize: "vertical" }} rows={3} placeholder={`Findings for ${b.findingsName}…`} value={form.findings[b.key] || ""} onChange={(e) => patch((f) => ({ findings: { ...f.findings, [b.key]: e.target.value } }))} />
                  </div>
                </div>
              ))}
            </Section>
          )}

          <Section icon="💬" title="General Comments / Findings">
            <textarea style={{ ...S.input, minHeight: 90, resize: "vertical" }} rows={4} placeholder="Enter observations, findings, or follow-up items…" value={form.generalComments} onChange={(e) => patch({ generalComments: e.target.value })} />
          </Section>

          <Section icon="📸" title="Photo Documentation">
            <p style={{ fontFamily: F.body, fontSize: 12, color: "#64748b", margin: "0 0 12px" }}>Tap a slot to take a photo or choose from your gallery.</p>
            <PhotoSlots slots={form.photos} onChange={(photos) => patch({ photos })} onOpen={setLightbox} />
            <button type="button" style={{ ...S.btnSecondary, width: "100%", marginTop: 12 }} onClick={() => patch((f) => ({ photos: [...f.photos, { id: Date.now(), dataUrl: null, caption: "" }] }))}>+ Add More Photo Slots</button>
          </Section>

          <Section icon="✅" title="Post-Job Safety Checklist" color={SAFETY}>
            {POSTJOB_TASKS.map((task, i) => (
              <CheckRow key={task} label={task} state={form.postJobChecks[String(i)] ?? null} onChange={(s) => patch((f) => ({ postJobChecks: { ...f.postJobChecks, [String(i)]: s } }))} />
            ))}
          </Section>

          <Section icon="📊" title="Completion Summary">
            <label style={S.label}>Tasks Completed</label>
            <input style={S.input} value={form.tasksCompleted} onChange={(e) => patch({ tasksCompleted: e.target.value })} placeholder="e.g. 8/8" />
            <label style={S.label}>Follow-up Required?</label>
            <div style={{ display: "flex", gap: 16, fontFamily: F.body, fontSize: 14 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}><input type="radio" name="followup" checked={form.followUp} onChange={() => patch({ followUp: true })} /> Yes</label>
              <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}><input type="radio" name="followup" checked={!form.followUp} onChange={() => patch({ followUp: false })} /> No</label>
            </div>
            <label style={S.label}>Summary Notes{form.followUp ? " *" : ""}</label>
            <textarea style={{ ...S.input, minHeight: 70, resize: "vertical", borderColor: form.followUp && !form.summaryNotes.trim() ? "#fca5a5" : undefined }} rows={3} placeholder={form.followUp ? "Describe what needs to be followed up…" : "Final summary or follow-up details…"} value={form.summaryNotes} onChange={(e) => patch({ summaryNotes: e.target.value })} />
            <label style={S.label}>Email report to</label>
            <input style={S.input} value={form.emailTo} onChange={(e) => patch({ emailTo: e.target.value })} placeholder="name@versantmedia.com, …" inputMode="email" autoCapitalize="off" />
          </Section>

          <Section icon="✍️" title="Technician Signatures">
            <p style={{ fontFamily: F.body, fontSize: 12, color: "#64748b", margin: "0 0 12px" }}>Each technician must sign below to confirm the work has been completed.</p>
            {form.techNames.length === 0 && <p style={{ fontFamily: F.body, fontSize: 13, color: "#94a3b8", textAlign: "center", padding: 12 }}>Add technician name(s) above to generate signature fields.</p>}
            {form.techNames.map((name) => {
              const sig = form.compSigs[name] || { dataUrl: null, signed: false };
              return (
                <div key={name} style={{ border: `1.5px solid ${sig.signed ? "#A5D6A7" : "#e2e8f0"}`, borderRadius: 10, padding: 12, marginBottom: 10, background: sig.signed ? "#F1F8E9" : "#fff" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <span style={{ fontFamily: F.body, fontSize: 13, fontWeight: 700, color: NAVY }}>{name}</span>
                    <span style={{ fontFamily: F.body, fontSize: 11, fontWeight: 700, color: sig.signed ? SAFETY : "#b45309", background: sig.signed ? "#E8F5E9" : "#FEF3C7", padding: "2px 8px", borderRadius: 10 }}>{sig.signed ? "✓ Signed" : "Pending"}</span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
                    <div><label style={{ ...S.label, marginTop: 0 }}>Print Name</label><input style={{ ...S.input, background: "#f1f5f9" }} value={name} readOnly /></div>
                    <div><label style={{ ...S.label, marginTop: 0 }}>Date</label><input style={{ ...S.input, background: "#f1f5f9" }} value={formatPmDate(form.date || today())} readOnly /></div>
                  </div>
                  <SignaturePad value={sig.dataUrl} disabled={sig.signed} onChange={(dataUrl) => patch((f) => ({ compSigs: { ...f.compSigs, [name]: { dataUrl, signed: false } } }))} />
                  <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    <button type="button" style={{ ...S.btnPrimary, flex: 1, background: sig.signed ? SAFETY : NAVY }} onClick={() => { if (!sig.dataUrl) { flash("Please sign above before confirming.", "err"); return; } patch((f) => ({ compSigs: { ...f.compSigs, [name]: { ...sig, signed: true } } })); }}>{sig.signed ? "✓ SIGNED & CONFIRMED" : "Confirm Signature"}</button>
                    <button type="button" style={S.btnSecondary} onClick={() => patch((f) => ({ compSigs: { ...f.compSigs, [name]: { dataUrl: null, signed: false } } }))}>Clear</button>
                  </div>
                </div>
              );
            })}
          </Section>

          <button type="button" style={{ ...S.btnExport, marginTop: 4 }} onClick={() => void submit()}>📧 Email Report{online ? "" : " (queued until online)"}</button>
          <p style={{ fontFamily: F.body, fontSize: 11, color: "#94a3b8", textAlign: "center", marginTop: 8 }}>The report is saved to PM Records with a PDF and emailed with the PDF and photos attached.</p>
        </div>
      )}
      <div style={{ height: 90 }} />
    </div>
  );
}

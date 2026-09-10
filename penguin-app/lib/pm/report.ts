// Turns a completed PM record into the email body and the PDF — ported from the
// old sheet's saveAndEmail() and the records browser's buildPDFFromRecord().
import type { PmRecord } from "./types";
import { formatPmDate } from "./types";

const SAFETY_LABELS = ["Personal Protective Equipment (PPE)", "Pre-Job Safety", "Electrical Safety", "Gas & Chemical Safety"];
const esc = (s: string) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const nl = (s: string) => esc(s).replace(/\n/g, "<br>");

export const serviceLabel = (frequency: string) => (frequency === "Repair" ? "Repair" : `${frequency} PM`);

export function emailSubjectFor(r: Pick<PmRecord, "equipment" | "frequency" | "technician" | "pmDate" | "followUp">) {
  const s = `${r.equipment} - ${serviceLabel(r.frequency)} - ${r.technician} - ${formatPmDate(r.pmDate)}`;
  return r.followUp ? `⚠️ FOLLOW-UP REQUIRED — ${s}` : s;
}

export function pdfFilenameFor(r: Pick<PmRecord, "equipment" | "frequency" | "pmDate">) {
  const first = (r.equipment || "PM").split(",")[0].replace(/[^a-zA-Z0-9]/g, "_").slice(0, 30);
  return `PM_${first}_${r.frequency}_${r.pmDate || "no-date"}.pdf`;
}

/** Email body. Photo/signature `url`s may be https or data URLs. */
export function buildEmailHtml(r: PmRecord): string {
  const dateFormatted = formatPmDate(r.pmDate);
  let html = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;"><div style="background:#1B3A5C;color:#fff;padding:16px 20px;border-radius:10px 10px 0 0;"><h2 style="margin:0;font-size:18px;">📋 PM Work Order Report</h2><p style="margin:4px 0 0;font-size:12px;opacity:0.7;">HVAC Engineering — Local 68</p></div><div style="border:1px solid #e2e8f0;border-top:none;padding:20px;border-radius:0 0 10px 10px;">`;
  if (r.followUp) html += `<div style="background:#FEF2F2;border:2px solid #DC2626;border-radius:10px;padding:16px;margin:16px 0;text-align:center;"><div style="font-size:16px;font-weight:800;color:#DC2626;">⚠️ FOLLOW-UP REQUIRED</div><div style="color:#7F1D1D;font-size:14px;margin-top:8px;">${nl(r.followUpNotes)}</div></div>`;
  const row = (k: string, v: string, style = "font-weight:600;") => `<tr><td style="padding:6px 0;color:#64748b;width:140px;">${k}</td><td style="padding:6px 0;${style}">${v}</td></tr>`;
  html += `<table style="width:100%;border-collapse:collapse;font-size:14px;">${row("Facility:", esc(r.facility))}${row("Equipment:", esc(r.equipment))}${row("Service:", esc(r.frequency))}${row("Technician(s):", esc(r.technician))}${row("Date:", dateFormatted)}${r.tasksCompleted ? row("Tasks Completed:", esc(r.tasksCompleted)) : ""}${row("Follow-up:", r.followUp ? "YES" : "No", `font-weight:700;color:${r.followUp ? "#DC2626" : "#16a34a"};`)}</table>`;

  if (r.safetyData.length) {
    html += `<div style="margin:16px 0;"><div style="font-size:14px;font-weight:700;color:#1B3A5C;margin-bottom:8px;">Safety Checklist</div>`;
    r.safetyData.forEach((section, si) => {
      html += `<div style="font-size:12px;font-weight:700;color:#64748b;margin:8px 0 4px;text-transform:uppercase;">${SAFETY_LABELS[si] || "Section"}</div>`;
      section.forEach((s) => { html += `<div style="padding:2px 0;font-size:12px;">${s.done ? "✅" : s.na ? "➖" : "⬜"} ${esc(s.task)}${s.condition ? ` <span style="color:#64748b;">(${esc(s.condition)})</span>` : ""}</div>`; });
    });
    html += `</div>`;
  }
  r.checklistData.forEach((cl) => {
    html += `<div style="margin:16px 0;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;"><div style="background:#1B3A5C;color:#fff;padding:8px 12px;font-size:13px;font-weight:700;">${esc(cl.header)}</div><div style="padding:8px 12px;">`;
    cl.tasks.forEach((t) => { html += `<div style="padding:3px 0;font-size:13px;color:#334155;">${t.done ? "✅" : "⬜"} ${esc(t.text)}</div>`; });
    const readings = Object.entries(cl.readings || {}).filter(([, v]) => v);
    if (readings.length) html += `<div style="margin-top:6px;font-size:12px;color:#334155;"><b>Readings:</b> ${readings.map(([k, v]) => `${esc(k)}: ${esc(v)}`).join(" · ")}</div>`;
    if (cl.findings) html += `<div style="margin-top:8px;padding:8px;background:#FFF8E1;border-radius:6px;border:1px solid #FFE082;font-size:13px;color:#92400E;"><b>Findings:</b> ${nl(cl.findings)}</div>`;
    html += `</div></div>`;
  });
  if (r.photos.length) {
    html += `<div style="margin:16px 0;"><div style="font-size:14px;font-weight:700;color:#1B3A5C;margin-bottom:8px;">📸 Photos</div>`;
    r.photos.forEach((p, i) => { html += `<div style="margin:8px 0;"><img src="${p.url}" style="width:100%;max-width:500px;border-radius:8px;border:1px solid #e2e8f0;" /><div style="font-size:12px;color:#64748b;margin-top:4px;font-weight:600;">📸 ${esc(p.caption || (p.kind === "loto" ? "LOTO Photo" : "Photo") + " " + (i + 1))}</div></div>`; });
    html += `</div>`;
  }
  if (r.postJobData.length) {
    html += `<div style="margin:16px 0;"><div style="font-size:14px;font-weight:700;color:#E65100;margin-bottom:8px;">✅ Post-Job Checklist</div>`;
    r.postJobData.forEach((s) => { html += `<div style="padding:3px 0;font-size:12px;">${s.done ? "✅" : s.na ? "➖" : "⬜"} ${esc(s.task)}</div>`; });
    html += `</div>`;
  }
  if (r.generalComments) html += `<div style="margin-top:16px;padding:12px;background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0;"><div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Comments / Findings</div><div style="font-size:14px;color:#1e293b;">${nl(r.generalComments)}</div></div>`;
  for (const type of ["safety", "completion"] as const) {
    const sigs = r.signatureData.filter((s) => s.type === type);
    if (!sigs.length) continue;
    html += `<div style="margin:16px 0;"><div style="font-size:14px;font-weight:700;color:#1B3A5C;margin-bottom:12px;">✍️ ${type === "safety" ? "Safety" : "Completion"} Signatures</div>`;
    sigs.forEach((s) => { html += `<div style="margin:8px 0;padding:10px;border:1px solid #e2e8f0;border-radius:8px;background:#f8fafc;"><div style="font-size:12px;font-weight:700;color:#1B3A5C;margin-bottom:6px;">${type === "safety" ? "🛡" : "✅"} ${esc(s.name)} — ${type === "safety" ? "Safety" : "Completion"}</div><img src="${s.url}" style="max-width:300px;height:60px;border:1px solid #e2e8f0;border-radius:4px;background:#fff;" /></div>`; });
    html += `</div>`;
  }
  html += `<p style="color:#94a3b8;font-size:11px;margin-top:20px;">Sent from Penguin Maintenance at ${new Date().toLocaleString("en-US", { timeZone: "America/New_York" })}</p></div></div>`;
  return html;
}

/** Fetch an https image as a data URL (Supabase Storage public objects allow CORS). */
export async function toDataUrl(url: string): Promise<string | null> {
  if (url.startsWith("data:")) return url;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve) => { const fr = new FileReader(); fr.onload = () => resolve(String(fr.result)); fr.onerror = () => resolve(null); fr.readAsDataURL(blob); });
  } catch { return null; }
}

/** Text-based A4 PDF (fast on phones). Returns base64. Images are fetched if needed. */
export async function buildPdf(r: PmRecord): Promise<string> {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ unit: "mm", format: "a4" });
  const margin = 12, pageW = 210, pageH = 297, contentW = pageW - 2 * margin;
  let y = margin;
  const clean = (s: unknown) => String(s ?? "").replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}️‍]/gu, "").replace(/\s{2,}/g, " ").trim();
  const checkPage = (needed: number) => { if (y + needed > pageH - margin) { pdf.addPage(); y = margin; } };
  const line = (text: string, o: { size?: number; bold?: boolean; color?: [number, number, number]; x?: number; width?: number } = {}) => {
    const size = o.size || 10;
    pdf.setFont("helvetica", o.bold ? "bold" : "normal"); pdf.setFontSize(size); pdf.setTextColor(...(o.color || [30, 41, 59]));
    const lines: string[] = pdf.splitTextToSize(clean(text), o.width || contentW);
    lines.forEach((l) => { checkPage(size * 0.5); pdf.text(l, o.x || margin, y); y += size * 0.42 + 0.5; });
  };
  const header = (text: string, color: [number, number, number] = [27, 58, 92]) => {
    checkPage(12); y += 3; pdf.setFillColor(...color); pdf.rect(margin, y - 4, contentW, 7, "F");
    pdf.setFont("helvetica", "bold"); pdf.setFontSize(11); pdf.setTextColor(255, 255, 255); pdf.text(clean(text), margin + 2, y + 1); y += 7;
  };

  pdf.setFillColor(27, 58, 92); pdf.rect(0, 0, pageW, 18, "F");
  pdf.setFont("helvetica", "bold"); pdf.setFontSize(14); pdf.setTextColor(255, 255, 255); pdf.text("PM Work Order Report", margin, 8);
  pdf.setFontSize(9); pdf.setFont("helvetica", "normal"); pdf.text("HVAC Engineering — Local 68", margin, 13);
  y = 24;

  if (r.followUp) {
    pdf.setFillColor(254, 242, 242); pdf.setDrawColor(220, 38, 38); pdf.rect(margin, y - 1, contentW, 14, "FD");
    pdf.setFont("helvetica", "bold"); pdf.setFontSize(11); pdf.setTextColor(220, 38, 38); pdf.text("FOLLOW-UP REQUIRED", margin + 2, y + 4);
    pdf.setFontSize(9); pdf.setTextColor(127, 29, 29); pdf.setFont("helvetica", "normal");
    const fn: string[] = pdf.splitTextToSize(clean(r.followUpNotes), contentW - 4); pdf.text(fn, margin + 2, y + 9); y += 14 + (fn.length - 1) * 4 + 3;
  }

  header("Work Order Details");
  const details: [string, string][] = [["Facility", r.facility], ["Equipment", r.equipment], ["Service", r.frequency], ["Technician(s)", r.technician], ["Date", formatPmDate(r.pmDate)], ["Tasks Completed", r.tasksCompleted || "—"], ["Follow-up", r.followUp ? "YES" : "No"]];
  pdf.setFont("helvetica", "normal"); pdf.setFontSize(10);
  for (const [k, v] of details) {
    checkPage(6); pdf.setTextColor(100, 116, 139); pdf.text(k + ":", margin, y); pdf.setTextColor(30, 41, 59); pdf.setFont("helvetica", "bold");
    const w: string[] = pdf.splitTextToSize(clean(v || "—"), contentW - 40); pdf.text(w, margin + 38, y); pdf.setFont("helvetica", "normal"); y += Math.max(5, w.length * 4.5);
  }
  if (r.generalComments) { header("Comments / Findings"); line(r.generalComments); }
  if (r.safetyData.length) {
    header("Safety Checklist");
    r.safetyData.forEach((section, si) => {
      checkPage(8); line(SAFETY_LABELS[si] || "Section", { size: 9, bold: true, color: [100, 116, 139] });
      section.forEach((s) => line(`${s.done ? "[X]" : s.na ? "[N/A]" : "[ ]"} ${s.task}${s.condition ? ` (${s.condition})` : ""}`, { size: 9 }));
      y += 1;
    });
  }
  if (r.checklistData.length) {
    header("PM Checklist");
    r.checklistData.forEach((cl) => {
      checkPage(10); line(cl.header, { size: 10, bold: true, color: [27, 58, 92] });
      cl.tasks.forEach((t) => line(`${t.done ? "[X]" : "[ ]"} ${t.text}`, { size: 9 }));
      const readings = Object.entries(cl.readings || {}).filter(([, v]) => v);
      if (readings.length) line("Readings: " + readings.map(([k, v]) => `${k}: ${v}`).join(", "), { size: 9, color: [51, 65, 85] });
      if (cl.findings) { y += 1; line("Findings: " + cl.findings, { size: 9, color: [146, 64, 14] }); }
      y += 2;
    });
  }
  if (r.postJobData.length) {
    header("Post-Job Checklist", [230, 81, 0]);
    r.postJobData.forEach((s) => line(`${s.done ? "[X]" : s.na ? "[N/A]" : "[ ]"} ${s.task}`, { size: 9 }));
  }
  if (r.photos.length) {
    header("Photos", [230, 81, 0]);
    for (const p of r.photos) {
      const data = await toDataUrl(p.url);
      if (!data) continue;
      checkPage(80);
      try { pdf.addImage(data, "JPEG", margin + 5, y, contentW - 10, 65, undefined, "FAST"); y += 67; line(p.caption || "Photo", { size: 9, color: [100, 116, 139] }); y += 3; } catch { /* skip bad image */ }
    }
  }
  if (r.signatureData.length) {
    header("Signatures");
    for (const s of r.signatureData) {
      checkPage(35); line(`${s.type === "safety" ? "Safety" : "Completion"} — ${s.name}`, { size: 10, bold: true });
      const data = await toDataUrl(s.url);
      if (data) { try { pdf.addImage(data, "PNG", margin + 5, y, 60, 20); y += 22; } catch { y += 2; } }
    }
  }
  const pages = pdf.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    pdf.setPage(i); pdf.setFontSize(8); pdf.setTextColor(150, 150, 150);
    pdf.text(`Page ${i} of ${pages} · Generated ${new Date().toLocaleString("en-US", { timeZone: "America/New_York" })}`, margin, pageH - 5);
  }
  return pdf.output("datauristring").split(",")[1];
}

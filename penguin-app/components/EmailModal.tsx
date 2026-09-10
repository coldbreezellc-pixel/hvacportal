"use client";
import { useState } from "react";
import { S, F } from "./styles";

export interface EmailDraft {
  to: string;
  subject: string;
  text: string;
  filename: string;
  csv: string;
}

/** Compose-and-send sheet for reports. The CSV is attached server-side, so it
 *  works from a phone with no email client set up. */
export function EmailModal({ draft, onSend, onDownload, onClose }: { draft: EmailDraft; onSend: (d: EmailDraft) => void; onDownload: () => void; onClose: () => void }) {
  const [d, setD] = useState(draft);
  const set = <K extends keyof EmailDraft>(k: K, v: EmailDraft[K]) => setD((p) => ({ ...p, [k]: v }));
  return (
    <div role="dialog" aria-modal="true" onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 250, background: "rgba(15,23,42,0.55)", display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ width: "100%", maxWidth: 560, background: "#fff", borderRadius: "16px 16px 0 0", padding: "18px 18px calc(18px + env(safe-area-inset-bottom, 0px))", maxHeight: "92vh", overflowY: "auto", boxShadow: "0 -10px 40px rgba(0,0,0,0.25)" }}>
        <h3 style={{ fontFamily: F.heading, fontSize: 16, color: "#0f172a", margin: "0 0 4px" }}>📧 Email Report</h3>
        <p style={{ fontFamily: F.body, fontSize: 12, color: "#64748b", margin: 0 }}>Attaches <b>{d.filename}</b>. Sends from your phone even without an email app.</p>
        <label style={S.label}>To (comma separated)</label>
        <input style={S.input} value={d.to} onChange={(e) => set("to", e.target.value)} placeholder="name@versantmedia.com, …" autoCapitalize="off" inputMode="email" />
        <label style={S.label}>Subject</label>
        <input style={S.input} value={d.subject} onChange={(e) => set("subject", e.target.value)} />
        <label style={S.label}>Message</label>
        <textarea style={{ ...S.input, minHeight: 110, resize: "vertical" }} value={d.text} onChange={(e) => set("text", e.target.value)} />
        <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
          <button style={{ ...S.btnPrimary, flex: 1, minWidth: 140 }} onClick={() => { if (d.to.trim()) onSend(d); }}>Send Email</button>
          <button style={S.btnSecondary} onClick={onDownload}>⬇ Download file</button>
          <button style={S.btnSecondary} onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

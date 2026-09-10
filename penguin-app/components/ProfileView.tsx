"use client";
import { useState } from "react";
import type { User } from "@/lib/types";
import { changeOwnPassword } from "@/lib/store";
import { S, F } from "./styles";

export function ProfileView({ user, mustReset }: { user: User; mustReset: boolean }) {
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (pw1.length < 6) return setErr("Minimum 6 characters.");
    if (pw1 !== pw2) return setErr("Passwords don't match.");
    setErr("");
    setBusy(true);
    const ok = await changeOwnPassword(pw1);
    setBusy(false);
    if (ok) { setPw1(""); setPw2(""); }
  };
  return (
    <div className="pg-page pg-page--narrow">
      <h2 style={S.pageTitle}>{mustReset ? "Set New Password" : "My Profile"}</h2>
      <div style={S.card}>
        <p style={{ fontFamily: F.body, fontSize: 13, color: "#64748b", margin: "0 0 4px" }}>Signed in as</p>
        <p style={{ fontFamily: F.heading, fontSize: 16, color: "#0f172a", margin: "0 0 2px" }}>{user.displayName}</p>
        <p style={{ fontFamily: F.body, fontSize: 12, color: "#64748b", margin: "0 0 2px" }}>@{user.username} · {user.role}</p>
        <p style={{ fontFamily: F.body, fontSize: 12, color: "#64748b", margin: "0 0 16px" }}>{user.email}</p>
        {mustReset && <p style={{ fontFamily: F.body, fontSize: 13, color: "#f59e0b", margin: "0 0 14px" }}>⚠ You must set a new password to continue.</p>}
        <label style={S.label}>New Password</label>
        <input style={S.input} type="password" value={pw1} onChange={(e) => setPw1(e.target.value)} placeholder="Min 6 characters" autoComplete="new-password" />
        <label style={S.label}>Confirm Password</label>
        <input style={S.input} type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} placeholder="Repeat password" autoComplete="new-password" onKeyDown={(e) => e.key === "Enter" && submit()} />
        {err && <p style={{ fontFamily: F.body, fontSize: 12, color: "#ef4444", margin: "6px 0 0" }}>{err}</p>}
        <button style={{ ...S.btnPrimary, marginTop: 10, opacity: busy ? 0.6 : 1 }} onClick={submit} disabled={busy}>{busy ? "Saving…" : "Change Password"}</button>
      </div>
    </div>
  );
}

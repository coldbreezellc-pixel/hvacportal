"use client";
import { useState } from "react";
import { login } from "@/lib/store";
import { Diamond } from "./Diamond";
import { S, F } from "./styles";

export function LoginScreen({ onForgot }: { onForgot: () => void }) {
  const [u, setU] = useState("");
  const [p, setP] = useState("");
  const [loading, setLoading] = useState(false);
  const submit = async () => {
    if (!u.trim() || !p.trim() || loading) return;
    setLoading(true);
    try { await login(u.trim(), p.trim()); } finally { setLoading(false); }
  };
  return (
    <div style={S.authWrap}>
      <div style={S.authCard}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <Diamond size={52} />
          <h1 style={{ fontFamily: F.heading, fontSize: 26, color: "#0f172a", margin: "10px 0 0", letterSpacing: 2, fontWeight: 800 }}>PENGUIN</h1>
          <p style={{ fontFamily: F.body, fontSize: 11, color: "#0d9488", margin: "2px 0 10px", letterSpacing: 1.5, fontWeight: 700 }}>An EMCOR Company</p>
          <p style={{ fontFamily: F.body, fontSize: 13, color: "#94a3b8", margin: 0 }}>Maintenance Inventory · Local 68</p>
        </div>
        <label style={S.label} htmlFor="login-username">Username</label>
        <input id="login-username" style={S.input} value={u} onChange={(e) => setU(e.target.value)} placeholder="Enter username" onKeyDown={(e) => e.key === "Enter" && submit()} autoCapitalize="off" autoCorrect="off" autoComplete="username" spellCheck={false} />
        <label style={S.label} htmlFor="login-password">Password</label>
        <input id="login-password" style={S.input} type="password" value={p} onChange={(e) => setP(e.target.value)} placeholder="Enter password" onKeyDown={(e) => e.key === "Enter" && submit()} autoCapitalize="off" autoCorrect="off" autoComplete="current-password" spellCheck={false} />
        <button style={{ ...S.btnPrimary, marginTop: 8, opacity: loading ? 0.6 : 1 }} onClick={submit} disabled={loading}>{loading ? "Signing in…" : "Sign In"}</button>
        <button style={S.btnLink} onClick={onForgot}>Forgot password?</button>
      </div>
    </div>
  );
}

"use client";
import { useState } from "react";
import { forgotPassword, flash } from "@/lib/store";
import { Diamond } from "./Diamond";
import { S, F } from "./styles";

const maskEmail = (email: string) => {
  const [local, domain] = email.split("@");
  if (!domain) return email;
  const shown = local.slice(0, 2);
  return `${shown}${"•".repeat(Math.max(2, local.length - 2))}@${domain}`;
};

export function ForgotScreen({ onBack }: { onBack: () => void }) {
  const [u, setU] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!u.trim() || loading) return;
    if (!navigator.onLine) { flash("You're offline — password reset needs a connection.", "err"); return; }
    setLoading(true);
    const email = await forgotPassword(u.trim());
    setLoading(false);
    if (!email) { flash("Username not found.", "err"); return; }
    setSentTo(email);
  };

  return (
    <div style={S.authWrap}>
      <div style={S.authCard}>
        <div style={{ textAlign: "center", marginBottom: 20 }}>
          <Diamond size={44} />
          <h1 style={{ fontFamily: F.heading, fontSize: 20, color: "#0f172a", margin: "10px 0 4px", letterSpacing: 1, fontWeight: 800 }}>Reset Password</h1>
        </div>
        {sentTo ? (
          <>
            <div style={{ ...S.card, background: "#f0fdf4", border: "1px solid #86efac", textAlign: "center", padding: 20 }}>
              <p style={{ fontFamily: F.body, color: "#16a34a", margin: 0, fontSize: 14, fontWeight: 700 }}>✓ Reset email sent!</p>
              <p style={{ fontFamily: F.body, color: "#64748b", margin: "10px 0 0", fontSize: 13 }}>
                Check <b>{maskEmail(sentTo)}</b> for a link to choose a new password.
              </p>
              <p style={{ fontFamily: F.body, color: "#64748b", margin: "8px 0 0", fontSize: 12 }}>
                The link works once and expires after an hour. No email? Ask an admin to reset your password from User Management.
              </p>
            </div>
            <button style={{ ...S.btnPrimary, marginTop: 16 }} onClick={onBack}>Back to Login</button>
          </>
        ) : (
          <>
            <p style={{ fontFamily: F.body, fontSize: 13, color: "#64748b", margin: "0 0 16px" }}>Enter your username. We&apos;ll email you a link to set a new password.</p>
            <label style={S.label} htmlFor="forgot-username">Username</label>
            <input id="forgot-username" style={S.input} value={u} onChange={(e) => setU(e.target.value)} placeholder="Your username" onKeyDown={(e) => e.key === "Enter" && submit()} autoCapitalize="off" autoCorrect="off" spellCheck={false} />
            <button style={{ ...S.btnPrimary, marginTop: 8, opacity: loading ? 0.6 : 1 }} onClick={submit} disabled={loading}>{loading ? "Sending…" : "Send Reset Email"}</button>
            <button style={S.btnLink} onClick={onBack}>Back to Login</button>
          </>
        )}
      </div>
    </div>
  );
}

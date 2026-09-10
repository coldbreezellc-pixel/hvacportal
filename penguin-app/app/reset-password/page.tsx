"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { getSupabase, supabaseConfigured } from "@/lib/supabase/client";
import { Diamond } from "@/components/Diamond";
import { S, F, globalCSS } from "@/components/styles";

/** Landing page for the password-reset email link. */
export default function ResetPasswordPage() {
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hasSession, setHasSession] = useState<boolean | null>(null);

  useEffect(() => {
    const linkErr = new URLSearchParams(window.location.search).get("error");
    if (linkErr) setErr(linkErr);
    if (!supabaseConfigured()) { setHasSession(false); return; }
    const sb = getSupabase();
    sb.auth.getSession().then(({ data }) => setHasSession(!!data.session));
    const { data: sub } = sb.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || session) setHasSession(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const submit = async () => {
    if (pw1.length < 6) return setErr("Minimum 6 characters.");
    if (pw1 !== pw2) return setErr("Passwords don't match.");
    setErr("");
    setBusy(true);
    const sb = getSupabase();
    const { error } = await sb.auth.updateUser({ password: pw1 });
    if (error) { setErr(error.message); setBusy(false); return; }
    await sb.rpc("clear_must_reset_pw");
    setDone(true);
    setBusy(false);
    setTimeout(() => { window.location.href = "/"; }, 1200);
  };

  return (
    <div style={S.authWrap}>
      <style>{globalCSS}</style>
      <div style={S.authCard}>
        <div style={{ textAlign: "center", marginBottom: 20 }}>
          <Diamond size={44} />
          <h1 style={{ fontFamily: F.heading, fontSize: 20, color: "#0f172a", margin: "10px 0 4px", letterSpacing: 1, fontWeight: 800 }}>Set New Password</h1>
        </div>
        {done ? (
          <p style={{ fontFamily: F.body, color: "#16a34a", fontSize: 14, fontWeight: 700, textAlign: "center" }}>✓ Password updated — taking you to the app…</p>
        ) : hasSession === false ? (
          <>
            <p style={{ fontFamily: F.body, fontSize: 13, color: "#64748b", margin: "0 0 12px" }}>
              {err || "This reset link is invalid or has expired."}
            </p>
            <Link href="/" style={{ ...S.btnPrimary, display: "block", textAlign: "center", textDecoration: "none" }}>Back to Login</Link>
          </>
        ) : (
          <>
            <label style={S.label}>New Password</label>
            <input style={S.input} type="password" value={pw1} onChange={(e) => setPw1(e.target.value)} placeholder="Min 6 characters" autoComplete="new-password" />
            <label style={S.label}>Confirm Password</label>
            <input style={S.input} type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} placeholder="Repeat password" autoComplete="new-password" onKeyDown={(e) => e.key === "Enter" && submit()} />
            {err && <p style={{ fontFamily: F.body, fontSize: 12, color: "#ef4444", margin: "6px 0 0" }}>{err}</p>}
            <button style={{ ...S.btnPrimary, marginTop: 10, opacity: busy ? 0.6 : 1 }} onClick={submit} disabled={busy}>{busy ? "Saving…" : "Change Password"}</button>
          </>
        )}
      </div>
    </div>
  );
}

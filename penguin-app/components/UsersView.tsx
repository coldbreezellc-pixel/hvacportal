"use client";
import { useState } from "react";
import type { Role, User } from "@/lib/types";
import { createUser, updateUser, deleteUser, resetPassword } from "@/lib/store";
import { autoUsername, autoEmail } from "@/lib/usernames";
import { S, F, genTempPassword } from "./styles";

interface UserFormData { username: string; displayName: string; email: string; role: Role; password: string }

function UserForm({ user, onSave, onCancel }: { user: User | null; onSave: (d: UserFormData) => void | Promise<void>; onCancel: () => void }) {
  const [f, setF] = useState<UserFormData>({ username: user?.username || "", displayName: user?.displayName || "", email: user?.email || "", role: user?.role || "crew", password: "" });
  const [emailTouched, setEmailTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof UserFormData>(k: K, v: UserFormData[K]) => setF((prev) => ({ ...prev, [k]: v }));

  const handleNameChange = (val: string) => {
    set("displayName", val);
    if (!user) {
      set("username", autoUsername(val));
      if (!emailTouched) set("email", autoEmail(val));
    }
  };

  const handleSave = async () => {
    if (!f.displayName.trim() || !f.username.trim()) return;
    if (!user && f.password.length < 6) return;
    setBusy(true);
    try { await onSave(f); } finally { setBusy(false); }
  };

  return (
    <div style={{ ...S.card, border: "1.5px solid #e2e8f0", marginBottom: 12 }}>
      <h3 style={{ fontFamily: F.heading, fontSize: 15, color: "#1e293b", margin: "0 0 12px" }}>{user ? "Edit User" : "New User"}</h3>
      <label style={S.label}>Full Name *</label>
      <input style={S.input} value={f.displayName} onChange={(e) => handleNameChange(e.target.value)} placeholder="e.g. John Smith" />
      <label style={S.label}>Username {!user && <span style={{ color: "#64748b", fontWeight: 400 }}>(auto-generated)</span>}</label>
      <input style={{ ...S.input, background: user ? "#f1f5f9" : "#f8fafc", color: user ? "#94a3b8" : "#1e293b" }} value={f.username} onChange={(e) => set("username", e.target.value)} placeholder="login username" autoCapitalize="off" disabled={!!user} />
      <label style={S.label}>Email {!user && <span style={{ color: "#64748b", fontWeight: 400 }}>(auto-generated)</span>}</label>
      <input style={S.input} type="email" value={f.email} onChange={(e) => { setEmailTouched(true); set("email", e.target.value); }} placeholder="firstname.lastname@versantmedia.com" autoCapitalize="off" />
      {!user && (
        <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
          <div style={{ flex: 1 }}>
            <label style={S.label}>Temporary Password *</label>
            <input style={S.input} type="text" value={f.password} onChange={(e) => set("password", e.target.value)} placeholder="Min 6 characters" autoCapitalize="off" />
          </div>
          <button style={{ ...S.btnSecondary, marginBottom: 0, padding: "10px 12px", whiteSpace: "nowrap" }} onClick={() => set("password", genTempPassword())} title="Generate random password">🎲 Gen</button>
        </div>
      )}
      <label style={S.label}>Role</label>
      <select style={{ ...S.select, width: "100%" }} value={f.role} onChange={(e) => set("role", e.target.value as Role)}><option value="crew">Crew</option><option value="admin">Admin</option></select>
      {!user && <p style={{ fontFamily: F.body, fontSize: 12, color: "#64748b", margin: "8px 0 0" }}>They&apos;ll sign in with the username and temporary password, then be asked to choose their own.</p>}
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button style={{ ...S.btnPrimary, opacity: busy ? 0.6 : 1 }} onClick={handleSave} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
        <button style={S.btnSecondary} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

export function UsersView({ users, currentUserId }: { users: User[]; currentUserId: string }) {
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [rpUser, setRpUser] = useState<User | null>(null);
  const [newPw, setNewPw] = useState("");
  const [confirmDel, setConfirmDel] = useState<string | null>(null);

  return (
    <div className="pg-page pg-page--narrow">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, gap: 10 }}>
        <h2 style={{ ...S.pageTitle, margin: 0 }}>User Management</h2>
        <button style={{ ...S.btnPrimary, width: "auto" }} onClick={() => { setEditing(null); setShowForm(true); }}>+ Add User</button>
      </div>

      {showForm && (
        <UserForm user={editing} onSave={async (data) => {
          if (editing) {
            await updateUser(editing.id, { displayName: data.displayName, email: data.email, role: data.role });
          } else {
            const created = await createUser(data);
            if (!created) return; // keep the form open so they can fix the error
          }
          setShowForm(false); setEditing(null);
        }} onCancel={() => { setShowForm(false); setEditing(null); }} />
      )}

      {rpUser && (
        <div style={{ ...S.card, border: "1.5px solid #e2e8f0", marginBottom: 12 }}>
          <h3 style={{ fontFamily: F.heading, fontSize: 14, color: "#1e293b", margin: "0 0 10px" }}>Reset Password — {rpUser.displayName}</h3>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
            <div style={{ flex: 1 }}>
              <label style={S.label}>New Temporary Password</label>
              <input style={S.input} type="text" value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder="Temporary password" autoCapitalize="off" />
            </div>
            <button style={{ ...S.btnSecondary, padding: "10px 12px" }} onClick={() => setNewPw(genTempPassword())}>🎲</button>
          </div>
          <p style={{ fontFamily: F.body, fontSize: 12, color: "#64748b", margin: "4px 0 10px" }}>User will be required to change this on next login.</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button style={{ ...S.btnPrimary, width: "auto" }} onClick={async () => {
              if (newPw.length < 6) return;
              await resetPassword(rpUser.id, newPw);
              setRpUser(null); setNewPw("");
            }}>Reset Password</button>
            <button style={S.btnSecondary} onClick={() => { setRpUser(null); setNewPw(""); }}>Cancel</button>
          </div>
        </div>
      )}

      {users.map((u) => (
        <div key={u.id} style={S.itemCard}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: F.heading, fontSize: 14, color: "#1e293b" }}>{u.displayName}</div>
              <div style={{ fontFamily: F.body, fontSize: 12, color: "#64748b" }}>@{u.username} · {u.role}{u.mustResetPw ? " · ⚠ must reset pw" : ""}</div>
              {u.email && <div style={{ fontFamily: F.body, fontSize: 11, color: "#64748b", overflowWrap: "anywhere" }}>{u.email}</div>}
            </div>
            {u.id !== currentUserId && (
              <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                <button style={{ ...S.qtyBtn, fontSize: 12 }} title="Reset Password" onClick={() => { setRpUser(u); setNewPw(""); }}>🔑</button>
                <button style={{ ...S.qtyBtn, fontSize: 12 }} title="Edit" onClick={() => { setEditing(u); setShowForm(true); }}>✏️</button>
                <button style={{ ...S.qtyBtn, fontSize: 12, color: "#ef4444" }} title="Delete" onClick={() => setConfirmDel(u.id)}>✕</button>
              </div>
            )}
          </div>
          {confirmDel === u.id && (
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #e2e8f0", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontFamily: F.body, fontSize: 13, color: "#f87171", flex: 1 }}>Delete {u.displayName}?</span>
              <button style={{ ...S.btnDel, padding: "6px 14px", fontSize: 12 }} onClick={async () => { await deleteUser(u.id); setConfirmDel(null); }}>Yes, Delete</button>
              <button style={{ ...S.btnSecondary, padding: "6px 14px", fontSize: 12 }} onClick={() => setConfirmDel(null)}>Cancel</button>
            </div>
          )}
        </div>
      ))}
      <div style={{ height: 80 }} />
    </div>
  );
}

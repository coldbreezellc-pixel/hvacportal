"use client";
import { useEffect } from "react";
import { useStore, init, setView, logout } from "@/lib/store";
import { S, F } from "./styles";
import { LoginScreen } from "./LoginScreen";
import { ForgotScreen } from "./ForgotScreen";
import { Header } from "./Header";
import { Dashboard } from "./Dashboard";
import { InventoryView } from "./InventoryView";
import { UsersView } from "./UsersView";
import { ProfileView } from "./ProfileView";
import { LogsView } from "./LogsView";
import { BackupsView } from "./BackupsView";
import { HomeView } from "./HomeView";
import { WorkOrdersView } from "./WorkOrdersView";
import { PmSheetView } from "./pm/PmSheetView";
import { PmRecordsView } from "./pm/PmRecordsView";

// Sessions never time out: crews fill in paperwork over long stretches and must
// not be bounced to the login screen. Supabase refresh tokens keep the session
// alive until someone taps Sign Out.

export function App() {
  const s = useStore();

  useEffect(() => { void init(); }, []);

  if (!s.ready) {
    return (
      <div style={S.loadWrap}>
        <div style={S.spinner} />
        <p style={{ color: "#64748b", marginTop: 16, fontFamily: F.body }}>Loading inventory…</p>
      </div>
    );
  }

  if (!s.configured) {
    return (
      <div style={S.authWrap}>
        <div style={S.authCard}>
          <h1 style={{ fontFamily: F.heading, fontSize: 18, color: "#0f172a", margin: "0 0 10px" }}>Supabase isn&apos;t configured</h1>
          <p style={{ fontFamily: F.body, fontSize: 13, color: "#64748b" }}>
            Set <code>NEXT_PUBLIC_SUPABASE_URL</code> and <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> (see <code>.env.example</code>) and redeploy.
          </p>
        </div>
      </div>
    );
  }

  const me = s.me;
  const lowStock = s.items.filter((i) => (i.qty || 0) <= (i.minQty || 0) && (i.minQty || 0) > 0);
  const openWos = s.workOrders.filter((w) => w.status !== "Completed").length;

  return (
    <div className="pg-shell">
      {s.toast && <div style={{ ...S.toast, background: s.toast.type === "err" ? "#dc2626" : "#16a34a" }}>{s.toast.msg}</div>}

      {!me ? (
        s.view === "forgot" ? <ForgotScreen onBack={() => setView("login")} /> : <LoginScreen onForgot={() => setView("forgot")} />
      ) : (
        <>
          <Header user={me} view={s.view} setView={setView} logout={() => void logout()} lowStock={lowStock.length} openWos={openWos}
            online={s.online} pending={s.pending} syncing={s.syncing} />
          {!s.online && <div className="pg-offline-banner">📡 No service — changes are saved on this phone and will upload automatically.</div>}
          {me.mustResetPw && s.view !== "profile" ? (
            <div className="pg-page pg-page--narrow">
              <div style={S.card}>
                <p style={{ fontFamily: F.body, color: "#d97706", margin: "0 0 12px" }}>⚠ You must change your password before continuing.</p>
                <button style={S.btnPrimary} onClick={() => setView("profile")}>Change Password</button>
              </div>
            </div>
          ) : (
            <>
              {s.view === "home" && <HomeView user={me} items={s.items} workOrders={s.workOrders} pmRecords={s.pmRecords} />}
              {s.view === "workorders" && <WorkOrdersView workOrders={s.workOrders} user={me} online={s.online} />}
              {s.view === "pmsheet" && <PmSheetView user={me} online={s.online} records={s.pmRecords} />}
              {s.view === "pmrecords" && <PmRecordsView records={s.pmRecords} user={me} online={s.online} />}
              {s.view === "dashboard" && <Dashboard items={s.items} lowStock={lowStock} />}
              {s.view === "inventory" && <InventoryView allItems={s.items} isAdmin={me.role === "admin"} online={s.online} />}
              {s.view === "users" && me.role === "admin" && <UsersView users={s.users} currentUserId={me.id} />}
              {s.view === "logs" && me.role === "admin" && <LogsView logs={s.logs} />}
              {s.view === "backups" && me.role === "admin" && <BackupsView online={s.online} />}
              {s.view === "profile" && <ProfileView user={me} mustReset={me.mustResetPw} />}
            </>
          )}
        </>
      )}
    </div>
  );
}

#!/usr/bin/env node
// Creates the default admin and (optionally) the crew roster in Supabase Auth.
// Needs the service-role key — run it from your machine, never from the browser.
//
//   SUPABASE_URL=https://xxxx.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=eyJ... \
//   node scripts/seed-users.mjs [--team] [--team-file ../data/pm_users.json]
//
// Options
//   --team                 also create the crew accounts from --team-file
//   --team-file <path>     JSON array of {username, displayName, email, role}
//   --team-password <pw>   temporary password for team accounts (default Penguin2026$)
//
// Environment
//   SEED_USER_PASSWORDS    optional JSON map {"username":"password"} to give specific
//                          people a known password instead of the temp one.
//
// Every account except the default admin is created with must_reset_pw = true, so
// people are forced to pick their own password on first sign-in.
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};

const EMAIL_DOMAIN = process.env.EMAIL_DOMAIN || "versantmedia.com";
const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

const autoEmail = (displayName, username) => {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]}.${parts[parts.length - 1]}`.toLowerCase().replace(/[^a-z0-9.]/g, "") + "@" + EMAIL_DOMAIN;
  }
  return `${username}@${EMAIL_DOMAIN}`;
};

async function findByEmail(email) {
  let page = 1;
  for (;;) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = data.users.find((u) => (u.email || "").toLowerCase() === email.toLowerCase());
    if (hit) return hit;
    if (data.users.length < 200) return null;
    page++;
  }
}

async function ensureUser({ username, displayName, email, role, password, mustResetPw }) {
  const existing = await findByEmail(email);
  const meta = { username, display_name: displayName, role, must_reset_pw: mustResetPw };
  if (existing) {
    const { error } = await supabase.auth.admin.updateUserById(existing.id, { user_metadata: meta });
    if (error) throw error;
    await supabase.from("users").upsert({ id: existing.id, username, display_name: displayName, email, role, must_reset_pw: mustResetPw });
    console.log(`= ${username} already exists (${email}) — profile refreshed`);
    return existing.id;
  }
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: meta,
  });
  if (error) throw error;
  console.log(`+ ${username} created (${email}, ${role})`);
  return data.user.id;
}

const overrides = (() => {
  try { return JSON.parse(process.env.SEED_USER_PASSWORDS || "{}"); } catch { return {}; }
})();

// Default admin — username admin, password admin123$
await ensureUser({
  username: "admin",
  displayName: "Administrator",
  email: process.env.ADMIN_EMAIL || `admin@${EMAIL_DOMAIN}`,
  role: "admin",
  password: process.env.ADMIN_PASSWORD || "admin123$",
  mustResetPw: process.env.ADMIN_FORCE_RESET === "true",
});

if (flag("--team")) {
  const file = path.resolve(here, opt("--team-file", "../../data/pm_users.json"));
  const team = JSON.parse(fs.readFileSync(file, "utf8"));
  const teamPw = opt("--team-password", process.env.TEAM_PASSWORD || "Penguin2026$");
  for (const u of team) {
    if (!u.username || u.username === "admin") continue;
    const email = u.email && u.email.includes("@") ? u.email : autoEmail(u.displayName || u.username, u.username);
    const pw = overrides[u.username] || teamPw;
    await ensureUser({
      username: u.username,
      displayName: u.displayName || u.username,
      email,
      role: u.role === "admin" ? "admin" : "crew",
      password: pw,
      mustResetPw: !overrides[u.username],
    });
  }
}

console.log("Done.");

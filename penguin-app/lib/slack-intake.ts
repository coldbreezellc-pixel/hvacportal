// Shared Slack → work-order intake used by:
//   • POST /api/intake/slack       (messages handed in by the hourly routine)
//   • POST /api/intake/slack/pull  (the app reads the channel itself with SLACK_USER_TOKEN)
//   • POST /api/slack/events       (real-time Slack Events API push)
// Only "Facilities Help Request" posts for our site(s) with a maintenance request
// type (HVAC / plumbing) become work orders; each Slack message ts is stored on the
// order so nothing is ever imported twice.
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseHelpRequest, requestSite, isMaintenanceRequest } from "./wo-parse";

export interface InMsg { ts: string; text: string; user?: string | null; posted_at?: string | null }
export interface CreatedWo { wo_number: string | null; title: string; location: string; priority: string; type?: string }
export interface ExistingWo { slack_ts: string; wo_number: string | null; title: string; status: string }
export interface IntakeResult {
  created: CreatedWo[]; skipped: number; ignored: number; ignored_not_maintenance: number; existing: ExistingWo[];
}

const timingSafeEqual = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};
/** True when the request carries the SLACK_INTAKE_TOKEN bearer; false when none is configured or it doesn't match. */
export function hasIntakeToken(req: Request): boolean {
  const expected = process.env.SLACK_INTAKE_TOKEN;
  if (!expected) return false;
  const given = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  return !!given && timingSafeEqual(given, expected);
}
export const intakeConfigured = () => !!process.env.SLACK_INTAKE_TOKEN;

export const intakeChannel = () => (process.env.SLACK_INTAKE_CHANNEL || "C09L3FCE541").trim();   // #help-facilities
export const intakeSites = () => (process.env.SLACK_INTAKE_SITES || "Englewood Cliffs").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
const allTypes = () => /^(1|true|yes)$/i.test(process.env.SLACK_INTAKE_ALL_TYPES || "");

export const looksLikeHelpRequest = (text: string) => /help request/i.test(text) || /description of (the )?issue/i.test(text);

/** Site filter: keep requests for our sites; a message that names no site is left to the parser. */
export function forOurSite(text: string): boolean {
  const site = requestSite(text);
  return !site || intakeSites().some((x) => site.toLowerCase().includes(x));
}

export async function importSlackMessages(admin: SupabaseClient, channel: string, messages: InMsg[], opts: { actor?: string } = {}): Promise<IntakeResult> {
  const wanted = messages.filter((m) => m && typeof m.ts === "string" && typeof m.text === "string" && looksLikeHelpRequest(m.text) && forOurSite(m.text));
  const ignored = messages.length - wanted.length;
  if (!wanted.length) return { created: [], skipped: 0, ignored, ignored_not_maintenance: 0, existing: [] };

  const { data: existing, error: exErr } = await admin.from("work_orders").select("slack_ts, wo_number, title, status")
    .eq("slack_channel", channel).in("slack_ts", wanted.map((m) => m.ts));
  if (exErr) throw exErr;
  const existingRows = (existing ?? []) as ExistingWo[];
  const seen = new Set(existingRows.map((r) => r.slack_ts));

  const created: CreatedWo[] = [];
  let skipped = 0, ignoredType = 0;
  // oldest first so WO numbers follow the order the requests came in
  for (const m of [...wanted].sort((a, b) => Number(a.ts) - Number(b.ts))) {
    if (seen.has(m.ts)) { skipped++; continue; }
    const who = (m.user || "").trim();
    const p = parseHelpRequest(m.text, who ? `Slack: ${who}` : "Slack");
    if (!allTypes() && !isMaintenanceRequest(p)) { ignoredType++; continue; }
    const createdAt = m.posted_at && !isNaN(Date.parse(m.posted_at)) ? new Date(m.posted_at).toISOString()
      : /^\d+(\.\d+)?$/.test(m.ts) ? new Date(Number(m.ts) * 1000).toISOString() : new Date().toISOString();
    const { data, error } = await admin.from("work_orders").insert({
      title: p.title, location: p.location, type: p.type, priority: p.priority, status: "Open", details: p.details,
      created_by: p.requester ? `Slack: ${p.requester}` : (who ? `Slack: ${who}` : "Slack"), source: "slack",
      slack_channel: channel, slack_ts: m.ts, created_at: createdAt,
    }).select("wo_number, title, location, priority, type").single();
    if (error) {
      if (error.code === "23505") { skipped++; continue; } // another intake path inserted this message first (work_orders_slack_msg_uidx)
      throw error;
    }
    created.push(data as CreatedWo);
    seen.add(m.ts);
  }
  if (created.length) {
    const { error: logErr } = await admin.from("activity_logs").insert({
      action: "WO Created", user_name: opts.actor || "Slack intake", user_id: null,
      detail: `Created ${created.length} work order(s) from Slack help requests: ${created.map((c) => c.wo_number).filter(Boolean).join(", ")}`,
    });
    if (logErr) console.error("Slack intake: activity log insert failed:", logErr.message);
  }
  return { created, skipped, ignored: ignored + ignoredType, ignored_not_maintenance: ignoredType, existing: existingRows };
}

// ── Reading Slack directly (user token) ─────────────────────────────────────
const slackApi = () => (process.env.SLACK_API_URL || "https://slack.com/api").replace(/\/$/, "");

interface SlackBlock { type?: string; text?: { text?: string } | string; elements?: SlackBlock[]; fields?: { text?: string }[] }
/** Flatten a message's blocks to text when Slack sends no top-level text (some workflow posts). */
export function blocksText(blocks: SlackBlock[] | undefined): string {
  if (!Array.isArray(blocks)) return "";
  const out: string[] = [];
  const walk = (b: SlackBlock) => {
    if (!b || typeof b !== "object") return;
    if (typeof b.text === "string") out.push(b.text);
    else if (b.text && typeof b.text.text === "string") out.push(b.text.text);
    if (Array.isArray(b.fields)) b.fields.forEach((f) => f?.text && out.push(f.text));
    if (Array.isArray(b.elements)) b.elements.forEach(walk);
  };
  blocks.forEach(walk);
  return out.join("\n").trim();
}

interface SlackMessage { type?: string; subtype?: string; ts: string; text?: string; user?: string; bot_id?: string; blocks?: SlackBlock[]; thread_ts?: string }
interface StoredToken { access_token: string; refresh_token?: string | null; expires_at?: number | null; seed?: string | null }

/** Short fingerprint of the env token a persisted (rotated) token descends from — never the token itself. */
async function fingerprint(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export class SlackError extends Error { constructor(public code: string, message?: string) { super(message || code); } }

/** Current user token: the persisted (rotated) one if any, else SLACK_USER_TOKEN.
 *  `canPersist` is false when public.app_settings does not exist yet — then a
 *  rotating token must NOT be refreshed, because Slack invalidates the old refresh
 *  token on use and the new one would be lost with the request. */
async function loadToken(admin: SupabaseClient): Promise<{ token: StoredToken | null; persisted: boolean; canPersist: boolean }> {
  let canPersist = true;
  const { data, error } = await admin.from("app_settings").select("value").eq("key", "slack_user_token").maybeSingle();
  if (error) canPersist = false;                       // 42P01 undefined_table (migration not run) or no grant
  const env = process.env.SLACK_USER_TOKEN?.trim();
  const seed = env ? await fingerprint(env) : null;
  const v = (data as { value?: StoredToken } | null)?.value;
  // A persisted token only counts while it descends from the current SLACK_USER_TOKEN:
  // setting a fresh token in Vercel must beat whatever was rotated from the old one.
  if (v?.access_token && (!v.seed || v.seed === seed)) return { token: { ...v, seed }, persisted: true, canPersist };
  return { token: env ? { access_token: env, refresh_token: process.env.SLACK_REFRESH_TOKEN?.trim() || null, expires_at: null, seed } : null, persisted: false, canPersist };
}

const canRefresh = (t: StoredToken | null) => !!(t?.refresh_token && process.env.SLACK_CLIENT_ID && process.env.SLACK_CLIENT_SECRET);
const PERSIST_HINT = "the renewed token could not be stored — run supabase/update-slack.sql (creates public.app_settings) and, if the refresh token was already used, issue a fresh token in the Slack app";

/** Exchange the refresh token for a new access token (Slack token rotation) and persist both.
 *  Persistence is verified before the exchange, since the exchange burns the old refresh token. */
async function refreshToken(admin: SupabaseClient, t: StoredToken, canPersist: boolean): Promise<StoredToken> {
  if (!canPersist) throw new SlackError("app_settings_missing", `Slack token needs renewing but ${PERSIST_HINT}`);
  const body = new URLSearchParams({ client_id: process.env.SLACK_CLIENT_ID!, client_secret: process.env.SLACK_CLIENT_SECRET!, grant_type: "refresh_token", refresh_token: t.refresh_token! });
  const res = await fetch(`${slackApi()}/oauth.v2.access`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  const j = await res.json().catch(() => ({})) as { ok?: boolean; error?: string; access_token?: string; refresh_token?: string; expires_in?: number; authed_user?: { access_token?: string; refresh_token?: string; expires_in?: number } };
  const access = j.access_token || j.authed_user?.access_token;
  const refresh = j.refresh_token || j.authed_user?.refresh_token || t.refresh_token;
  const expiresIn = j.expires_in || j.authed_user?.expires_in || 12 * 3600;
  if (!j.ok || !access) {
    if (j.error === "invalid_refresh_token") {
      // another request may have rotated it a moment ago — use what it stored
      const again = await loadToken(admin);
      if (again.persisted && again.token && again.token.access_token !== t.access_token) return again.token;
    }
    throw new SlackError(j.error || "refresh_failed", `Slack token refresh failed: ${j.error || "no token returned"}`);
  }
  const next: StoredToken = { access_token: access, refresh_token: refresh, expires_at: Date.now() + expiresIn * 1000, seed: t.seed ?? null };
  const { error } = await admin.from("app_settings").upsert({ key: "slack_user_token", value: next, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) throw new SlackError("persist_failed", `Slack token renewed but ${PERSIST_HINT} (${error.message})`);
  return next;
}

async function slackGet(token: string, method: string, params: Record<string, string>) {
  const url = `${slackApi()}/${method}?` + new URLSearchParams(params).toString();
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  return await res.json().catch(() => ({})) as { ok?: boolean; error?: string; needed?: string; messages?: SlackMessage[]; has_more?: boolean; response_metadata?: { next_cursor?: string } };
}

/**
 * Read the channel's messages since `oldestUnix` with the user token, refreshing a
 * rotated token when Slack says it expired. Thread replies are not included.
 */
export async function fetchSlackHistory(admin: SupabaseClient, channel: string, oldestUnix: number): Promise<{ messages: InMsg[]; tokenSource: string }> {
  const loaded = await loadToken(admin);
  let t = loaded.token;
  if (!t) throw new SlackError("not_configured", "SLACK_USER_TOKEN is not set on the server");
  if (t.expires_at && canRefresh(t) && Date.now() > t.expires_at - 5 * 60 * 1000) t = await refreshToken(admin, t, loaded.canPersist);

  const all: SlackMessage[] = [];
  let cursor = "";
  let refreshed = false;
  for (let page = 0; page < 10; page++) {
    const params: Record<string, string> = { channel, oldest: String(oldestUnix), limit: "200", inclusive: "true" };
    if (cursor) params.cursor = cursor;
    const j = await slackGet(t.access_token, "conversations.history", params);
    if (!j.ok) {
      if ((j.error === "token_expired" || j.error === "invalid_auth") && !refreshed && canRefresh(t)) { t = await refreshToken(admin, t, loaded.canPersist); refreshed = true; page--; continue; }
      const hints: Record<string, string> = {
        not_in_channel: "the Slack user must be a member of #help-facilities",
        channel_not_found: "the channel ID is wrong or the token belongs to another workspace",
        missing_scope: `the token lacks the ${j.needed || "channels:history"} scope`,
        token_expired: "the token expired — set SLACK_CLIENT_ID / SLACK_CLIENT_SECRET / SLACK_REFRESH_TOKEN so it can be renewed, or issue a non-rotating token",
        invalid_auth: "the token is invalid or revoked",
        token_revoked: "the token was revoked",
      };
      throw new SlackError(j.error || "slack_error", `Slack said ${j.error || "unknown error"}${hints[j.error || ""] ? ` — ${hints[j.error || ""]}` : ""}`);
    }
    all.push(...(j.messages || []));
    cursor = j.has_more ? (j.response_metadata?.next_cursor || "") : "";
    if (!cursor) break;
  }
  const messages: InMsg[] = all
    .filter((m) => m && typeof m.ts === "string" && (!m.thread_ts || m.thread_ts === m.ts))   // top-level posts only
    .map((m) => ({ ts: m.ts, text: (m.text && m.text.trim()) || blocksText(m.blocks), user: "", posted_at: new Date(Number(m.ts) * 1000).toISOString() }))
    .filter((m) => m.text);
  return { messages, tokenSource: loaded.persisted ? "app_settings" : "env" };
}

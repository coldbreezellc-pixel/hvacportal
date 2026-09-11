import { createAdminClient, errorResponse, HttpError } from "@/lib/supabase/server";
import { parseHelpRequest, requestSite, isMaintenanceRequest } from "@/lib/wo-parse";

export const runtime = "nodejs";

// POST /api/intake/slack — turn Slack "Facilities Help Request" posts into work
// orders. Called by the hourly Claude routine that reads #help-facilities with
// the user's own Slack login (no Slack app / admin access needed).
//
// Auth: Authorization: Bearer <SLACK_INTAKE_TOKEN>
// Body: { channel: "C…", messages: [{ ts, text, user?, posted_at? }] }
// Each Slack message ts is stored on the work order, so re-sending the same
// messages never creates duplicates. Only requests for our sites are taken:
// SLACK_INTAKE_SITES (comma-separated, default "Englewood Cliffs"); the channel
// also carries New York / Los Angeles / DC / Orlando requests, which are ignored.
// Only maintenance-type requests (HVAC / temperature, plumbing / leaks,
// electrical) become work orders; janitorial, furniture, artwork and the like
// are Facilities' and are ignored. Set SLACK_INTAKE_ALL_TYPES=true to take everything.

interface InMsg { ts: string; text: string; user?: string | null; posted_at?: string | null }

const timingSafeEqual = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

export async function POST(req: Request) {
  try {
    const expected = process.env.SLACK_INTAKE_TOKEN;
    if (!expected) throw new HttpError(503, "SLACK_INTAKE_TOKEN is not set on the server");
    const given = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (!given || !timingSafeEqual(given, expected)) throw new HttpError(401, "Bad intake token");

    const body = await req.json().catch(() => ({}));
    const channel = typeof body.channel === "string" ? body.channel.trim() : "";
    const messages: InMsg[] = Array.isArray(body.messages) ? body.messages.slice(0, 200) : [];
    if (!channel) throw new HttpError(400, "channel is required");
    for (const m of messages) if (!m || typeof m.ts !== "string" || typeof m.text !== "string") throw new HttpError(400, "each message needs ts and text");

    const admin = createAdminClient();
    const sites = (process.env.SLACK_INTAKE_SITES || "Englewood Cliffs").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
    const wanted = messages.filter((m) => {
      if (!(/help request/i.test(m.text) || /description of (the )?issue/i.test(m.text))) return false;
      const site = requestSite(m.text);
      return !site || sites.some((x) => site.toLowerCase().includes(x));   // no site named → let the parser decide
    });
    const ignored = messages.length - wanted.length;
    if (!wanted.length) return Response.json({ created: [], skipped: 0, ignored, ignored_not_maintenance: 0 });

    const { data: existing, error: exErr } = await admin.from("work_orders").select("slack_ts").eq("slack_channel", channel).in("slack_ts", wanted.map((m) => m.ts));
    if (exErr) throw exErr;
    const seen = new Set((existing ?? []).map((r: { slack_ts: string }) => r.slack_ts));

    const created: { wo_number: string | null; title: string; location: string; priority: string }[] = [];
    let skipped = 0, ignoredType = 0;
    const allTypes = /^(1|true|yes)$/i.test(process.env.SLACK_INTAKE_ALL_TYPES || "");
    // oldest first so WO numbers follow the order the requests came in
    for (const m of [...wanted].sort((a, b) => Number(a.ts) - Number(b.ts))) {
      if (seen.has(m.ts)) { skipped++; continue; }
      const who = (m.user || "").trim();
      const p = parseHelpRequest(m.text, who ? `Slack: ${who}` : "Slack");
      if (!allTypes && !isMaintenanceRequest(p)) { ignoredType++; continue; }
      const createdAt = m.posted_at && !isNaN(Date.parse(m.posted_at)) ? new Date(m.posted_at).toISOString()
        : /^\d+(\.\d+)?$/.test(m.ts) ? new Date(Number(m.ts) * 1000).toISOString() : new Date().toISOString();
      const { data, error } = await admin.from("work_orders").insert({
        title: p.title, location: p.location, type: p.type, priority: p.priority, status: "Open", details: p.details,
        created_by: p.requester ? `Slack: ${p.requester}` : (who ? `Slack: ${who}` : "Slack"), source: "slack",
        slack_channel: channel, slack_ts: m.ts, created_at: createdAt,
      }).select("wo_number, title, location, priority").single();
      if (error) {
        if (error.code === "23505") { skipped++; continue; } // raced with another run on the same ts
        throw error;
      }
      created.push(data as { wo_number: string | null; title: string; location: string; priority: string });
      seen.add(m.ts);
    }
    if (created.length) {
      await admin.from("activity_logs").insert({
        action: "WO Created", user_name: "Slack intake", user_id: null,
        detail: `Created ${created.length} work order(s) from Slack help requests: ${created.map((c) => c.wo_number).filter(Boolean).join(", ")}`,
      });
    }
    return Response.json({ created, skipped, ignored: ignored + ignoredType, ignored_not_maintenance: ignoredType });
  } catch (e) {
    return errorResponse(e);
  }
}

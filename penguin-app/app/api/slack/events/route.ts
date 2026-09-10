import { createAdminClient } from "@/lib/supabase/server";
import { verifySlackSignature, parseSlackMessage, postToSlack, woConfirmation } from "@/lib/slack";

export const runtime = "nodejs";

// Slack Events API webhook. Point the Slack app's Event Subscriptions request URL at
//   https://<app>/api/slack/events
// and subscribe to message.channels. Env: SLACK_SIGNING_SECRET (required),
// SLACK_BOT_TOKEN (optional, for confirmations), SLACK_ALLOWED_CHANNELS, SLACK_TRIGGER_KEYWORDS.

const allowedChannels = () => (process.env.SLACK_ALLOWED_CHANNELS || "").split(",").map((s) => s.trim()).filter(Boolean);
const triggerKeywords = () => (process.env.SLACK_TRIGGER_KEYWORDS || "wo,work order,cold call,repair,emergency").toLowerCase().split(",").map((s) => s.trim()).filter(Boolean);

// Dedup recently processed event ids (best effort — serverless instances are short-lived,
// so the DB unique check on slack_ts is the real guard)
const recent: string[] = [];

interface SlackEvent { type?: string; subtype?: string; bot_id?: string; text?: string; channel?: string; ts?: string; user?: string }
interface SlackBody { type?: string; challenge?: string; event_id?: string; event?: SlackEvent; authorizations?: { user_id: string }[] }

export async function POST(req: Request) {
  const raw = await req.text();
  let body: SlackBody = {};
  try { body = JSON.parse(raw); } catch { return new Response("bad json", { status: 400 }); }

  if (body.type === "url_verification") return Response.json({ challenge: body.challenge });
  if (!verifySlackSignature(raw, req.headers)) return new Response("Invalid signature", { status: 401 });

  if (body.event_id) {
    if (recent.includes(body.event_id)) return new Response("ok");
    recent.push(body.event_id); if (recent.length > 500) recent.shift();
  }
  if (body.type !== "event_callback" || !body.event) return new Response("ok");
  const event = body.event;
  if (event.type !== "message") return new Response("ok");
  if (event.subtype && event.subtype !== "file_share") return new Response("ok");
  if (event.bot_id || !event.text || !event.text.trim() || !event.channel) return new Response("ok");

  const channels = allowedChannels();
  if (channels.length && !channels.includes(event.channel)) return new Response("ok");

  const lower = event.text.toLowerCase();
  const botId = body.authorizations?.[0]?.user_id?.toLowerCase();
  const isMentioned = !!botId && lower.includes("<@" + botId);
  const hasKeyword = triggerKeywords().some((k) => lower.includes(k));
  if (!hasKeyword && !isMentioned && channels.length === 0) return new Response("ok");

  try {
    const admin = createAdminClient();
    // Same Slack message delivered twice → one work order
    if (event.ts) {
      const { data: dup } = await admin.from("work_orders").select("id").eq("slack_ts", event.ts).maybeSingle();
      if (dup) return new Response("ok");
    }
    const wo = parseSlackMessage(event.text, event.user ? `Slack:${event.user}` : "Slack");
    const { data, error } = await admin.from("work_orders")
      .insert({ ...wo, source: "slack", slack_channel: event.channel, slack_ts: event.ts ?? null })
      .select("wo_number, title, location, type, priority").single();
    if (error) throw error;
    await postToSlack(event.channel, woConfirmation(data), event.ts);
  } catch (e) {
    console.error("Slack → WO error:", e);
    await postToSlack(event.channel, `⚠️ Couldn't create work order: ${e instanceof Error ? e.message : e}`, event.ts);
  }
  return new Response("ok");
}

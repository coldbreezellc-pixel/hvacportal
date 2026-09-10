import crypto from "node:crypto";

// Ported from the Railway portal's server.js — same parsing rules so Slack
// messages turn into the same work orders they did before.

export function verifySlackSignature(rawBody: string, headers: Headers): boolean {
  const secret = process.env.SLACK_SIGNING_SECRET;
  if (!secret) return false;
  const sig = headers.get("x-slack-signature");
  const ts = headers.get("x-slack-request-timestamp");
  if (!sig || !ts) return false;
  if (Math.abs(Date.now() / 1000 - parseInt(ts, 10)) > 300) return false; // replay protection
  const computed = "v0=" + crypto.createHmac("sha256", secret).update(`v0:${ts}:${rawBody}`).digest("hex");
  try { return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(sig)); } catch { return false; }
}

export interface ParsedWo {
  title: string; location: string; type: string; priority: string; status: string; details: string; created_by: string;
}

/** Parse a Slack message into a work order. Smart-detects location, type, priority. */
export function parseSlackMessage(text: string, user: string): ParsedWo {
  const t = (text || "").replace(/\s+/g, " ").trim();

  let location = "Other";
  if (/\b904\b/.test(t) || /904\s*sylvan/i.test(t)) location = "904 Sylvan Ave";
  else if (/\b900\b/.test(t) || /900\s*sylvan/i.test(t)) location = "900 Sylvan Ave";

  let type = "Cold Call";
  if (/\bemergency\b/i.test(t)) type = "Emergency";
  else if (/\brepair\b/i.test(t)) type = "Repair";
  else if (/\bpm\b|preventive maintenance/i.test(t)) type = "Preventive Maintenance";
  else if (/\binstall(ation)?\b/i.test(t)) type = "Installation";
  else if (/\binspect(ion)?\b/i.test(t)) type = "Inspection";

  let priority = "Normal";
  if (/\b(urgent|asap|critical|emergency|down)\b/i.test(t)) priority = "Urgent";
  else if (/\bhigh\b/i.test(t) || /priority/i.test(t)) priority = "High";
  else if (/\blow\b|whenever|no rush/i.test(t)) priority = "Low";

  let title = t
    .replace(/^(wo|work order|create wo|new wo)[\s:.-]+/i, "")
    .replace(/<@[A-Z0-9]+>/g, "")
    .replace(/<#[A-Z0-9]+\|[^>]+>/g, "")
    .trim();
  if (!title) title = "Work order from Slack";
  if (title.length > 100) title = title.slice(0, 97) + "…";

  return { title, location, type, priority, status: "Open", details: t, created_by: user || "Slack" };
}

export async function postToSlack(channel: string, text: string, threadTs?: string) {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token || !channel) return null;
  try {
    const body: Record<string, string> = { channel, text };
    if (threadTs) body.thread_ts = threadTs;
    const resp = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(body),
    });
    return await resp.json();
  } catch (e) { console.error("postToSlack error:", e); return null; }
}

export const appUrl = () => (process.env.NEXT_PUBLIC_APP_URL || "https://penguin-maintenance.vercel.app").replace(/\/$/, "");

export const woConfirmation = (wo: { wo_number: string; title: string; location: string; type: string; priority: string }) =>
  `✅ Created *${wo.wo_number}* — _${wo.title}_\n• Location: ${wo.location}  • Type: ${wo.type}  • Priority: ${wo.priority}\n<${appUrl()}/?view=workorders|View in Work Orders>`;

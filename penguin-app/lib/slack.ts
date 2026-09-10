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

export { parseSlackMessage, parseHelpRequest, type ParsedWo } from "./wo-parse";

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

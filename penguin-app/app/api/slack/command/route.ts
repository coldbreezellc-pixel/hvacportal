import { createAdminClient } from "@/lib/supabase/server";
import { verifySlackSignature, parseSlackMessage, woConfirmation } from "@/lib/slack";

export const runtime = "nodejs";

// Slash command `/wo <description>`. Request URL: https://<app>/api/slack/command
export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifySlackSignature(raw, req.headers)) return new Response("Invalid signature", { status: 401 });
  const form = new URLSearchParams(raw);
  const text = (form.get("text") || "").trim();
  if (!text) {
    return Response.json({ response_type: "ephemeral", text: "Usage: `/wo <description>` — e.g. `/wo AC not cooling in studio B at 900 Sylvan urgent`" });
  }
  try {
    const userName = form.get("user_name");
    const wo = parseSlackMessage(text, userName ? `Slack:${userName}` : "Slack");
    const { data, error } = await createAdminClient().from("work_orders")
      .insert({ ...wo, source: "slack-slash", slack_channel: form.get("channel_id") })
      .select("wo_number, title, location, type, priority").single();
    if (error) throw error;
    return Response.json({ response_type: "in_channel", text: woConfirmation(data) });
  } catch (e) {
    return Response.json({ response_type: "ephemeral", text: `⚠️ Couldn't create work order: ${e instanceof Error ? e.message : e}` });
  }
}

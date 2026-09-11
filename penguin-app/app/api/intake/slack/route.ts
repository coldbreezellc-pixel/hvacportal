import { createAdminClient, errorResponse, HttpError } from "@/lib/supabase/server";
import { importSlackMessages, hasIntakeToken, intakeConfigured, type InMsg } from "@/lib/slack-intake";

export const runtime = "nodejs";

// POST /api/intake/slack — turn Slack "Facilities Help Request" posts, read by the
// hourly Claude routine, into work orders. See lib/slack-intake.ts for the rules
// (site filter, HVAC / plumbing only, de-duplicated by Slack message ts).
//
// Auth: Authorization: Bearer <SLACK_INTAKE_TOKEN>
// Body: { channel: "C…", messages: [{ ts, text, user?, posted_at? }] }

export async function POST(req: Request) {
  try {
    if (!intakeConfigured()) throw new HttpError(503, "SLACK_INTAKE_TOKEN is not set on the server");
    if (!hasIntakeToken(req)) throw new HttpError(401, "Bad intake token");
    const body = await req.json().catch(() => ({}));
    const channel = typeof body.channel === "string" ? body.channel.trim() : "";
    const messages: InMsg[] = Array.isArray(body.messages) ? body.messages.slice(0, 200) : [];
    if (!channel) throw new HttpError(400, "channel is required");
    for (const m of messages) if (!m || typeof m.ts !== "string" || typeof m.text !== "string") throw new HttpError(400, "each message needs ts and text");
    const result = await importSlackMessages(createAdminClient(), channel, messages);
    return Response.json(result);
  } catch (e) {
    return errorResponse(e);
  }
}

import { createAdminClient, createSessionClient, errorResponse, HttpError } from "@/lib/supabase/server";
import { fetchSlackHistory, importSlackMessages, intakeChannel, hasIntakeToken, SlackError } from "@/lib/slack-intake";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST /api/intake/slack/pull — the app reads #help-facilities itself (Slack Web API,
// SLACK_USER_TOKEN) and imports new Englewood Cliffs HVAC / plumbing requests.
// Called when someone opens Work Orders, by the "Pull from Slack" button, and by the
// hourly routine. Auth: a signed-in app user (cookie session) or the intake bearer token.
// Body (optional): { hours: 26 }  — how far back to look (1–168).

async function authorize(req: Request): Promise<string> {
  if (hasIntakeToken(req)) return "Slack intake";
  const session = await createSessionClient();
  const { data: { user } } = await session.auth.getUser();
  if (!user) throw new HttpError(401, "Sign in first");
  const { data: profile } = await createAdminClient().from("users").select("display_name").eq("id", user.id).maybeSingle();
  return `Slack pull by ${profile?.display_name || user.email || "user"}`;
}

// Every phone that opens Work Orders asks for a pull; one Slack read a minute per
// server instance is plenty and keeps the shared user token well under Slack's rate limits.
let lastUserPull = 0;
const USER_PULL_MIN_GAP_MS = 60 * 1000;

export async function POST(req: Request) {
  try {
    const actor = await authorize(req);
    const body = await req.json().catch(() => ({}));
    const hours = Math.min(168, Math.max(1, Number(body?.hours) || 26));
    const admin = createAdminClient();
    const channel = intakeChannel();
    if (actor !== "Slack intake" && !body?.force && Date.now() - lastUserPull < USER_PULL_MIN_GAP_MS) {
      return Response.json({ created: [], skipped: 0, ignored: 0, ignored_not_maintenance: 0, existing: [], checked: 0, hours, channel, throttled: true, checked_at: new Date().toISOString() });
    }
    if (actor !== "Slack intake") lastUserPull = Date.now();
    const oldest = Math.floor(Date.now() / 1000) - hours * 3600;
    let history;
    try { history = await fetchSlackHistory(admin, channel, oldest); }
    catch (e) {
      if (e instanceof SlackError && e.code === "not_configured") throw new HttpError(503, e.message);
      if (e instanceof SlackError) throw new HttpError(502, e.message);
      throw e;
    }
    const result = await importSlackMessages(admin, channel, history.messages, { actor });
    return Response.json({ ...result, checked: history.messages.length, hours, channel, checked_at: new Date().toISOString() });
  } catch (e) {
    return errorResponse(e);
  }
}

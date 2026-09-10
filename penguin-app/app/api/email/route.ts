import { createSessionClient, createAdminClient, errorResponse, HttpError } from "@/lib/supabase/server";

export const runtime = "nodejs";

interface Attachment { filename: string; content: string; contentType?: string }

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** POST /api/email — send a report (CSV/PDF attached) from the phone via Resend.
 *  Any signed-in user may send; the sender's name is stamped into the body.
 *  Body: { to, subject, text, html?, attachments? } — when `html` is given it is
 *  used as the message body (PM reports), otherwise `text` is turned into HTML. */
export async function POST(req: Request) {
  try {
    const session = await createSessionClient();
    const { data: { user }, error } = await session.auth.getUser();
    if (error || !user) throw new HttpError(401, "Not signed in");

    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) throw new HttpError(503, "Email isn't configured yet (RESEND_API_KEY). Use the download instead.");

    const admin = createAdminClient();
    const { data: profile } = await admin.from("users").select("display_name, email").eq("id", user.id).maybeSingle();
    const senderName = profile?.display_name || user.email || "Penguin crew";

    const body = await req.json();
    const to: string[] = (Array.isArray(body.to) ? body.to : String(body.to || "").split(/[,;\s]+/))
      .map((s: string) => s.trim().toLowerCase()).filter(Boolean);
    if (to.length === 0) throw new HttpError(400, "Add at least one recipient");
    const bad = to.find((e) => !EMAIL_RE.test(e));
    if (bad) throw new HttpError(400, `"${bad}" isn't a valid email`);
    if (to.length > 10) throw new HttpError(400, "Max 10 recipients");

    const subject = String(body.subject || "").trim().slice(0, 200) || "Penguin Maintenance report";
    const text = String(body.text || "").slice(0, 20000);
    const attachments: Attachment[] = Array.isArray(body.attachments) ? body.attachments.slice(0, 5) : [];
    let total = 0;
    for (const a of attachments) {
      if (!a || typeof a.filename !== "string" || typeof a.content !== "string") throw new HttpError(400, "Bad attachment");
      if (a.content.length > 12_000_000) throw new HttpError(400, "Attachment too large");
      total += a.content.length;
    }
    if (total > 30_000_000) throw new HttpError(400, "Attachments too large");

    const footer = `<p style="margin-top:18px;color:#64748b;font-size:12px">Sent by ${senderName.replace(/</g, "&lt;")} from Penguin Maintenance @ Versant Media.</p>`;
    const customHtml = typeof body.html === "string" && body.html.trim() ? String(body.html).slice(0, 2_000_000) : null;
    const html = customHtml
      ? customHtml + footer
      : `<div style="font-family:Segoe UI,system-ui,sans-serif;font-size:14px;color:#1e293b">${text
          .split("\n").map((l) => l.replace(/&/g, "&amp;").replace(/</g, "&lt;")).join("<br>")}${footer}</div>`;

    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM || "Penguin Maintenance <noreply@coldbreezellc.com>",
        to,
        reply_to: profile?.email || user.email,
        subject,
        text: `${text}\n\nSent by ${senderName} from Penguin Maintenance @ Versant Media.`,
        html,
        attachments: attachments.map((a) => ({ filename: a.filename, content: a.content, content_type: a.contentType || (a.filename.toLowerCase().endsWith(".pdf") ? "application/pdf" : "text/csv") })),
      }),
    });
    const result = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new HttpError(502, result.message || "Email provider rejected the message");
    return Response.json({ ok: true, id: result.id });
  } catch (e) {
    return errorResponse(e);
  }
}

import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createSessionClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/** Target of the "reset your password" email link. Accepts both link styles
 *  Supabase can send — `?code=` (default template, PKCE) and
 *  `?token_hash=&type=` (custom template) — signs the user in, and sends them
 *  to /reset-password. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const next = url.searchParams.get("next") || "/reset-password";
  const redirect = new URL(next.startsWith("/") ? next : "/reset-password", url.origin);

  const supabase = await createSessionClient();
  let message: string | null = null;

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(redirect);
    message = /verifier/i.test(error.message)
      ? "Please open the reset link on the same phone or computer (and same browser) where you requested it, or request a new one from there."
      : error.message;
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) return NextResponse.redirect(redirect);
    message = error.message;
  } else {
    message = "That link is missing its token. Request a new reset email.";
  }

  redirect.pathname = "/reset-password";
  redirect.searchParams.set("error", message);
  return NextResponse.redirect(redirect);
}

import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createSessionClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/** Target of the "reset your password" email link. Verifies the one-time token,
 *  signs the user in, and sends them to /reset-password. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const next = url.searchParams.get("next") || "/reset-password";
  const redirect = new URL(next.startsWith("/") ? next : "/reset-password", url.origin);

  if (tokenHash && type) {
    const supabase = await createSessionClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) return NextResponse.redirect(redirect);
    redirect.searchParams.set("error", error.message);
  } else {
    redirect.searchParams.set("error", "That link is missing its token. Request a new reset email.");
  }
  redirect.pathname = "/reset-password";
  return NextResponse.redirect(redirect);
}

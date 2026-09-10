import { requireAdmin, errorResponse, HttpError } from "@/lib/supabase/server";
import { autoUsername, autoEmail } from "@/lib/usernames";

export const runtime = "nodejs";

const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{1,31}$/i;
/** POST /api/admin/users — create a login (admin only). */
export async function POST(req: Request) {
  try {
    const { admin } = await requireAdmin();
    const body = await req.json();
    const displayName = String(body.displayName || "").trim();
    if (!displayName) throw new HttpError(400, "Full name is required");
    const username = String(body.username || autoUsername(displayName)).trim().toLowerCase();
    if (!USERNAME_RE.test(username)) throw new HttpError(400, "Username may only contain letters, numbers, . _ -");
    const email = String(body.email || autoEmail(displayName)).trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, "A valid email is required");
    const role = body.role === "admin" ? "admin" : "crew";
    const password = String(body.password || "");
    if (password.length < 6) throw new HttpError(400, "Temporary password must be at least 6 characters");

    const { data: clash } = await admin.from("users").select("id").ilike("username", username).maybeSingle();
    if (clash) throw new HttpError(409, `Username "${username}" is already taken`);

    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { username, display_name: displayName, role, must_reset_pw: true },
    });
    if (error) throw new HttpError(400, error.message);

    // The on_auth_user_created trigger creates the profile row; read it back.
    const { data: profile } = await admin.from("users").select("*").eq("id", data.user.id).single();
    return Response.json({ user: profile });
  } catch (e) {
    return errorResponse(e);
  }
}

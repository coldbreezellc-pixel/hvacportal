import { requireAdmin, errorResponse, HttpError } from "@/lib/supabase/server";

export const runtime = "nodejs";
type Ctx = { params: Promise<{ id: string }> };

/** POST /api/admin/users/:id/reset-password — set a temporary password (admin only).
 *  The user is forced to choose a new one at next sign-in. */
export async function POST(req: Request, { params }: Ctx) {
  try {
    const { admin } = await requireAdmin();
    const { id } = await params;
    const { password } = await req.json();
    if (typeof password !== "string" || password.length < 6) throw new HttpError(400, "Password must be at least 6 characters");
    const { error } = await admin.auth.admin.updateUserById(id, {
      password,
      user_metadata: { must_reset_pw: true },
    });
    if (error) throw new HttpError(400, error.message);
    await admin.from("users").update({ must_reset_pw: true }).eq("id", id);
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}

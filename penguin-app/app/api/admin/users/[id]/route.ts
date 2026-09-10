import { requireAdmin, errorResponse, HttpError } from "@/lib/supabase/server";

export const runtime = "nodejs";

const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{1,31}$/i;
type Ctx = { params: Promise<{ id: string }> };

/** PATCH /api/admin/users/:id — edit name, username, email, or role (admin only). */
export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const { admin, actor } = await requireAdmin();
    const { id } = await params;
    const body = await req.json();
    const patch: Record<string, unknown> = {};

    if (body.displayName !== undefined) {
      const v = String(body.displayName).trim();
      if (!v) throw new HttpError(400, "Full name is required");
      patch.display_name = v;
    }
    if (body.username !== undefined) {
      const v = String(body.username).trim().toLowerCase();
      if (!USERNAME_RE.test(v)) throw new HttpError(400, "Username may only contain letters, numbers, . _ -");
      const { data: clash } = await admin.from("users").select("id").ilike("username", v).neq("id", id).maybeSingle();
      if (clash) throw new HttpError(409, `Username "${v}" is already taken`);
      patch.username = v;
    }
    if (body.role !== undefined) {
      const role = body.role === "admin" ? "admin" : "crew";
      if (id === actor.id && role !== "admin") throw new HttpError(400, "You can't remove your own admin role");
      patch.role = role;
    }
    if (body.email !== undefined) {
      const v = String(body.email).trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) throw new HttpError(400, "A valid email is required");
      const { error } = await admin.auth.admin.updateUserById(id, { email: v, email_confirm: true });
      if (error) throw new HttpError(400, error.message);
      patch.email = v;
    }

    if (Object.keys(patch).length) {
      const { error } = await admin.from("users").update(patch).eq("id", id);
      if (error) throw new HttpError(400, error.message);
      // keep auth metadata in step so a future re-sync doesn't undo the edit
      await admin.auth.admin.updateUserById(id, {
        user_metadata: {
          ...(patch.username ? { username: patch.username } : {}),
          ...(patch.display_name ? { display_name: patch.display_name } : {}),
          ...(patch.role ? { role: patch.role } : {}),
        },
      });
    }
    const { data: profile } = await admin.from("users").select("*").eq("id", id).single();
    return Response.json({ user: profile });
  } catch (e) {
    return errorResponse(e);
  }
}

/** DELETE /api/admin/users/:id — remove a login (admin only). */
export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const { admin, actor } = await requireAdmin();
    const { id } = await params;
    if (id === actor.id) throw new HttpError(400, "You can't delete your own account");
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) throw new HttpError(400, error.message);
    await admin.from("users").delete().eq("id", id); // no-op if cascade already removed it
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}

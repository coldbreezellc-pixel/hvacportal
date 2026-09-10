import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import type { UserRow } from "../types";

/** Cookie-scoped client: acts as the signed-in browser user (RLS applies). */
export async function createSessionClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (list) => {
          try {
            list.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            /* called from a Route Handler after headers were sent — safe to ignore */
          }
        },
      },
    }
  );
}

/** Service-role client: bypasses RLS. Server only — never expose the key. */
export function createAdminClient(): SupabaseClient {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** Resolves the calling user and asserts they are an admin. */
export async function requireAdmin(): Promise<{ admin: SupabaseClient; actor: UserRow }> {
  const session = await createSessionClient();
  const { data: { user }, error } = await session.auth.getUser();
  if (error || !user) throw new HttpError(401, "Not signed in");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("users").select("*").eq("id", user.id).maybeSingle();
  if (!profile || profile.role !== "admin") throw new HttpError(403, "Admins only");
  return { admin, actor: profile as UserRow };
}

export function errorResponse(e: unknown) {
  const status = e instanceof HttpError ? e.status : 500;
  const message = e instanceof Error ? e.message : "Unexpected error";
  return Response.json({ error: message }, { status });
}

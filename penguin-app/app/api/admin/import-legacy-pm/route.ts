import fs from "node:fs/promises";
import path from "node:path";
import { requireAdmin, errorResponse } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 300;

// One-time import of the PM records the Railway portal archived as JSON files
// (pm-records/<year>/<month>/<file>.json, copied into penguin-app/legacy/pm-records).
// Photos and signatures embedded as base64 are moved into the pm-files bucket.

interface LegacyPhoto { caption?: string; image?: string; url?: string; dataUrl?: string }
interface LegacySig { type: string; name: string; image?: string }
interface LegacyRecord {
  id?: string; technician?: string; facility?: string; equipment?: string; frequency?: string; followUp?: boolean; followUpNotes?: string;
  tasksCompleted?: string; generalComments?: string; safetyData?: unknown[]; postJobData?: unknown[]; checklistData?: unknown[];
  signatureData?: LegacySig[]; lotoPhotos?: LegacyPhoto[]; emailHtml?: string; createdAt?: string; dateFormatted?: string; archivedBy?: string;
}

const MONTH_INDEX: Record<string, number> = { January: 1, February: 2, March: 3, April: 4, May: 5, June: 6, July: 7, August: 8, September: 9, October: 10, November: 11, December: 12 };

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else if (e.name.endsWith(".json")) out.push(p);
  }
  return out;
}

const b64ToBuffer = (s: string) => Buffer.from(s.includes(",") ? s.split(",")[1] : s, "base64");

export async function POST() {
  try {
    const { admin } = await requireAdmin();
    const root = path.join(process.cwd(), "legacy", "pm-records");
    let files: string[] = [];
    try { files = await walk(root); } catch { return Response.json({ imported: 0, skipped: 0, error: "No legacy files bundled" }); }

    const { data: existing } = await admin.from("pm_records").select("legacy_path").not("legacy_path", "is", null);
    const done = new Set((existing ?? []).map((r: { legacy_path: string }) => r.legacy_path));
    let imported = 0, skipped = 0; const errors: string[] = [];

    for (const file of files) {
      const rel = path.relative(root, file).split(path.sep).join("/");   // 2026/06-June/xx.json
      const legacyPath = "pm-records/" + rel;
      if (done.has(legacyPath)) { skipped++; continue; }
      try {
        const rec = JSON.parse(await fs.readFile(file, "utf8")) as LegacyRecord;
        const id = rec.id || rel.replace(/[^a-zA-Z0-9]/g, "-");
        const [year, monthDir, fname] = rel.split("/");
        const day = parseInt(fname.split("_")[0], 10);
        const month = MONTH_INDEX[monthDir.replace(/^\d+-/, "")] || 1;
        let pmDate = `${year}-${String(month).padStart(2, "0")}-${String(isNaN(day) ? 1 : day).padStart(2, "0")}`;
        if (rec.dateFormatted) { const m = /^(\d+)\/(\d+)\/(\d+)$/.exec(rec.dateFormatted); if (m) pmDate = `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`; }

        const upload = async (name: string, buf: Buffer, contentType: string) => {
          const key = `pm/${id}/${name}`;
          const { error } = await admin.storage.from("pm-files").upload(key, buf, { contentType, upsert: true });
          if (error) throw error;
          return admin.storage.from("pm-files").getPublicUrl(key).data.publicUrl;
        };

        const photos = [];
        for (const [i, p] of (rec.lotoPhotos || []).entries()) {
          let url: string | null = null;
          if (p.url && /^https?:/.test(p.url)) {
            try { const r = await fetch(p.url); if (r.ok) url = await upload(`photo-${i + 1}.jpg`, Buffer.from(await r.arrayBuffer()), r.headers.get("content-type") || "image/jpeg"); } catch { /* keep remote url */ }
            if (!url) url = p.url;
          } else if (p.image || p.dataUrl) {
            url = await upload(`photo-${i + 1}.jpg`, b64ToBuffer(p.image || p.dataUrl!), "image/jpeg");
          }
          if (url) photos.push({ caption: p.caption || `Photo ${i + 1}`, url, kind: /loto/i.test(p.caption || "") ? "loto" : "photo" });
        }
        const signatureData = [];
        for (const [i, s] of (rec.signatureData || []).entries()) {
          if (!s.image) continue;
          const url = await upload(`sig-${i + 1}.png`, b64ToBuffer(s.image), "image/png");
          signatureData.push({ type: s.type === "safety" ? "safety" : "completion", name: s.name, url });
        }
        const technician = rec.technician || rec.archivedBy || "";
        const { error } = await admin.from("pm_records").insert({
          id, pm_date: pmDate, facility: rec.facility || "", technician, technicians: technician.split(",").map((s) => s.trim()).filter(Boolean),
          equipment: rec.equipment || "", frequency: rec.frequency || "PM", follow_up: !!rec.followUp, follow_up_notes: rec.followUpNotes || "",
          tasks_completed: rec.tasksCompleted || "", general_comments: rec.generalComments || "",
          safety_data: rec.safetyData || [], post_job_data: rec.postJobData || [], checklist_data: rec.checklistData || [],
          signature_data: signatureData, photos, pdf_url: null, email_subject: null, email_to: [], email_sent_at: rec.createdAt || null,
          email_html: null, created_by: rec.archivedBy || technician || "Import", legacy_path: legacyPath, created_at: rec.createdAt || new Date().toISOString(),
        });
        if (error) throw error;
        imported++;
      } catch (e) {
        errors.push(`${rel}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return Response.json({ imported, skipped, errors });
  } catch (e) {
    return errorResponse(e);
  }
}

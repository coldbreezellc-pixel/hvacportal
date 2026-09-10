import type { Frequency } from "./data";

// ── Stored record (one completed PM / repair sheet) ──
export interface SafetyRow { task: string; done: boolean; na: boolean; condition?: string }
export interface ChecklistTask { text: string; done: boolean }
export interface ChecklistBlock { header: string; tasks: ChecklistTask[]; findings: string; readings?: Record<string, string> }
export interface PmPhoto { caption: string; url: string; kind: "loto" | "photo" }
export interface PmSignature { type: "safety" | "completion"; name: string; url: string }

export interface PmRecord {
  id: string;
  pmDate: string;            // YYYY-MM-DD
  facility: string;
  technician: string;
  technicians: string[];
  equipment: string;
  frequency: string;
  followUp: boolean;
  followUpNotes: string;
  tasksCompleted: string;
  generalComments: string;
  safetyData: SafetyRow[][];
  postJobData: SafetyRow[];
  checklistData: ChecklistBlock[];
  signatureData: PmSignature[];
  photos: PmPhoto[];
  pdfUrl: string | null;
  emailSubject: string | null;
  emailTo: string[];
  emailSentAt: string | null;
  emailHtml?: string | null;   // only loaded for detail/resend
  createdBy: string | null;
  legacyPath: string | null;
  createdAt: string;
}

export interface PmRecordRow {
  id: string; pm_date: string; facility: string; technician: string; technicians: string[]; equipment: string; frequency: string;
  follow_up: boolean; follow_up_notes: string; tasks_completed: string; general_comments: string;
  safety_data: SafetyRow[][]; post_job_data: SafetyRow[]; checklist_data: ChecklistBlock[]; signature_data: PmSignature[];
  photos: PmPhoto[]; pdf_url: string | null; email_subject: string | null; email_to: string[]; email_sent_at: string | null;
  email_html?: string | null; created_by: string | null; legacy_path: string | null; created_at: string;
}

export const pmRecordFromRow = (r: PmRecordRow): PmRecord => ({
  id: r.id, pmDate: r.pm_date, facility: r.facility, technician: r.technician, technicians: r.technicians ?? [],
  equipment: r.equipment, frequency: r.frequency, followUp: !!r.follow_up, followUpNotes: r.follow_up_notes ?? "",
  tasksCompleted: r.tasks_completed ?? "", generalComments: r.general_comments ?? "",
  safetyData: r.safety_data ?? [], postJobData: r.post_job_data ?? [], checklistData: r.checklist_data ?? [],
  signatureData: r.signature_data ?? [], photos: r.photos ?? [], pdfUrl: r.pdf_url ?? null,
  emailSubject: r.email_subject ?? null, emailTo: r.email_to ?? [], emailSentAt: r.email_sent_at ?? null,
  emailHtml: r.email_html, createdBy: r.created_by ?? null, legacyPath: r.legacy_path ?? null, createdAt: r.created_at,
});

export const pmRecordToRow = (p: PmRecord): PmRecordRow => ({
  id: p.id, pm_date: p.pmDate, facility: p.facility, technician: p.technician, technicians: p.technicians,
  equipment: p.equipment, frequency: p.frequency, follow_up: p.followUp, follow_up_notes: p.followUpNotes,
  tasks_completed: p.tasksCompleted, general_comments: p.generalComments, safety_data: p.safetyData,
  post_job_data: p.postJobData, checklist_data: p.checklistData, signature_data: p.signatureData, photos: p.photos,
  pdf_url: p.pdfUrl, email_subject: p.emailSubject, email_to: p.emailTo, email_sent_at: p.emailSentAt,
  email_html: p.emailHtml ?? null, created_by: p.createdBy, legacy_path: p.legacyPath, created_at: p.createdAt,
});

// ── Live form state (also what gets autosaved as the draft) ──
export type CheckState = "done" | "na" | null;
export interface UnitEntry { id: number; num: string }
export interface PhotoSlot { id: number; dataUrl: string | null; caption: string }
export interface SigState { dataUrl: string | null; signed: boolean }

export interface PmFormState {
  date: string;
  facility: string;
  techNames: string[];
  ppeAcknowledgedAt: string | null;
  safetyCompleted: boolean;
  safetyChecks: Record<string, CheckState>;      // `${sectionKey}|${index}`
  postJobChecks: Record<string, CheckState>;     // `${index}`
  lotoPhotos: PhotoSlot[];
  safetySigs: Record<string, SigState>;          // by technician name
  freq: Frequency;
  selectedEquip: string[];
  liebertUnits: UnitEntry[];
  equipUnits: Record<string, UnitEntry[]>;
  taskChecks: Record<string, boolean>;           // `${blockKey}|${taskIdx}`
  findings: Record<string, string>;              // blockKey
  readings: Record<string, string>;              // `${blockKey}|${label}`
  generalComments: string;
  photos: PhotoSlot[];
  tasksCompleted: string;
  followUp: boolean;
  summaryNotes: string;
  compSigs: Record<string, SigState>;
  emailTo: string;
  savedAt: string | null;
  savedBy: string | null;
}

export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export const emptyPmForm = (emailTo: string): PmFormState => ({
  date: today(), facility: "", techNames: [], ppeAcknowledgedAt: null, safetyCompleted: false,
  safetyChecks: {}, postJobChecks: {}, lotoPhotos: [], safetySigs: {},
  freq: "Quarterly", selectedEquip: [], liebertUnits: [], equipUnits: {},
  taskChecks: {}, findings: {}, readings: {},
  generalComments: "", photos: [{ id: 1, dataUrl: null, caption: "" }, { id: 2, dataUrl: null, caption: "" }, { id: 3, dataUrl: null, caption: "" }, { id: 4, dataUrl: null, caption: "" }],
  tasksCompleted: "", followUp: false, summaryNotes: "", compSigs: {}, emailTo, savedAt: null, savedBy: null,
});

export const formatPmDate = (ds: string) => {
  if (!ds) return "";
  const d = new Date(ds + "T00:00:00");
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
};

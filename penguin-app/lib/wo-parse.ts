// Turns a pasted help request (usually copied out of Slack) into a work order.
// No Node imports here — this runs in the browser (paste → Generate) and on the
// server (Slack events / slash command) with the same rules as the old portal.

export interface ParsedWo {
  title: string; location: string; type: string; priority: string; status: string; details: string; created_by: string;
  requester: string | null;
  /** Site named in the form header ("Submitted for Englewood Cliffs"), if any. */
  site: string | null;
  /** Labelled fields found in the paste (Slack workflow form), keyed by normalised label. */
  fields: Record<string, string>;
}

/** Strip Slack mrkdwn (*bold*, _italic_, ~strike~) — the API delivers the form with the labels bold and the values italic. */
export const stripMrkdwn = (s: string) => s.replace(/\*/g, "").replace(/(^|[\s(])[_~]+/g, "$1").replace(/[_~]+(?=[\s).,!?;:]|$)/g, "");

/** Site from the workflow header, e.g. "Englewood Cliffs" / "New York" / "Los Angeles". */
export function requestSite(text: string): string | null {
  const t = stripMrkdwn(text).replace(EMOJI_RE, "").replace(/\s+/g, " ");
  const m = /help request submitted for ([^!.\n•]+)/i.exec(t);
  return m ? m[1].trim() : null;
}

// Labels the Facilities Help Request workflow (and similar Slack forms) use.
// Longer labels first so "Request Priority" wins over "Priority". No word
// boundary before a label: when a form message is copied out of Slack the
// fields run together ("Medium PriorityFloor #: ground").
const FIELD_LABELS = [
  "Description of issues", "Description of issue", "Description of the issue", "Description of problem", "Description",
  "Request Priority", "Priority level", "Priority",
  "Request Type", "Type of request", "Type of issue", "Issue Type", "Category",
  "Floor #", "Floor number", "Floor", "Room #", "Room number", "Room", "Suite", "Area",
  "Building", "Location", "Site", "Facility",
  "Submitted by", "Requested by", "Requester", "Your name", "Full name", "Contact name", "Contact", "Email", "Phone", "Department",
  "Preferred date", "Date needed", "Deadline", "Notes", "Additional notes", "Additional details",
];
const LABEL_RE = new RegExp("(" + FIELD_LABELS.map((l) => l.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s*")).join("|") + ")\\s*:\\s*", "gi");
const EMOJI_RE = /[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\uFE0F]|:[a-z0-9_+-]+:(?:skin-tone-\d:)?/giu;  // unicode emoji + Slack :shortcodes:
const normLabel = (l: string) => l.toLowerCase().replace(/\s+/g, " ").replace(/\s*#$/, "").trim();
const canon = (l: string) => {
  const n = normLabel(l);
  if (n.startsWith("description")) return "description";
  if (n.includes("priority")) return "priority";
  if (n === "request type" || n === "type of request" || n === "type of issue" || n === "issue type" || n === "category") return "category";
  if (n.startsWith("floor")) return "floor";
  if (n.startsWith("room") || n === "suite" || n === "area") return "room";
  if (n === "building" || n === "location" || n === "site" || n === "facility") return "building";
  if (["submitted by", "requested by", "requester", "your name", "full name", "contact name", "contact"].includes(n)) return "requester";
  if (n === "notes" || n === "additional notes" || n === "additional details") return "notes";
  return n;
};

/** Pull "Label: value" pairs out of a copied Slack form message. Returns {} unless at least two fields are present. */
export function parseFormFields(text: string): Record<string, string> {
  const t = text.replace(/\s+/g, " ");
  const hits: { key: string; start: number; end: number }[] = [];
  for (const m of t.matchAll(LABEL_RE)) hits.push({ key: canon(m[1]), start: m.index!, end: m.index! + m[0].length });
  if (hits.length < 2) return {};
  const out: Record<string, string> = {};
  hits.forEach((h, i) => {
    const value = t.slice(h.end, i + 1 < hits.length ? hits[i + 1].start : undefined).replace(EMOJI_RE, "").replace(/\s+/g, " ").trim().replace(/\s*the full request details.*$/i, "").replace(/[\s,;•·*-]+$/, "").replace(/^[\s•·*-]+/, "");
    if (value && !(h.key in out)) out[h.key] = value;
  });
  return out;
}

const mapPriority = (label: string, fallback: string) => {
  const l = label.toLowerCase();
  if (/urgent|critical|emergency|immediate|highest/.test(l)) return "Urgent";
  if (/high/.test(l)) return "High";
  if (/medium|normal|standard/.test(l)) return "Normal";
  if (/low|minor|whenever/.test(l)) return "Low";
  return fallback;
};
const mapType = (category: string, fallback: string) => {
  const c = category.toLowerCase();
  if (/emergency/.test(c)) return "Emergency";
  if (/inspect/.test(c)) return "Inspection";
  if (/install/.test(c)) return "Installation";
  if (/preventive|\bpm\b/.test(c)) return "Preventive Maintenance";
  if (/hvac|temperature|heat|cool|air|plumb|leak|water|electric|light|power|repair|broken|noise|door|ceiling/.test(c)) return "Repair";
  return fallback;
};
const buildingFrom = (s: string) => (/\b904\b/.test(s) ? "904 Sylvan Ave" : /\b900\b/.test(s) ? "900 Sylvan Ave" : null);

const TIME_RE = /^\d{1,2}:\d{2}(\s?[AP]M)?$/i;
const NAME_TIME_RE = /^(.{2,60}?)\s{1,}(\d{1,2}:\d{2}(?:\s?[AP]M)?)$/i;
// "Yesterday at 3:12 PM", "Today at 9:01 AM", "Sep 9th at 10:32 AM", "[10:32 AM]"
const STAMP_RE = /^(\[?\d{1,2}:\d{2}(\s?[AP]M)?\]?|(today|yesterday|mon|tue|wed|thu|fri|sat|sun)[a-z]*\s+at\s+\d{1,2}:\d{2}(\s?[AP]M)?|[a-z]{3,9}\s+\d{1,2}(st|nd|rd|th)?(,?\s+\d{4})?\s+at\s+\d{1,2}:\d{2}(\s?[AP]M)?)$/i;

function detect(t: string) {
  let location = "Other";
  if (/\b904\b/.test(t) || /904\s*sylvan/i.test(t)) location = "904 Sylvan Ave";
  else if (/\b900\b/.test(t) || /900\s*sylvan/i.test(t)) location = "900 Sylvan Ave";

  let type = "Cold Call";
  if (/\bemergency\b/i.test(t)) type = "Emergency";
  else if (/\brepair\b/i.test(t)) type = "Repair";
  else if (/\bpm\b|preventive maintenance/i.test(t)) type = "Preventive Maintenance";
  else if (/\binstall(ation)?\b/i.test(t)) type = "Installation";
  else if (/\binspect(ion)?\b/i.test(t)) type = "Inspection";

  let priority = "Normal";
  if (/\b(urgent|asap|critical|emergency|down|immediately|right away)\b/i.test(t)) priority = "Urgent";
  else if (/\bhigh\b/i.test(t) || /priority/i.test(t)) priority = "High";
  else if (/\blow\b|whenever|no rush/i.test(t)) priority = "Low";
  return { location, type, priority };
}

const cleanLine = (s: string) => s
  .replace(/<@[A-Z0-9]+>/g, "").replace(/<#[A-Z0-9]+\|[^>]+>/g, "")
  .replace(/^(wo|work order|create wo|new wo|help|request)[\s:.-]+/i, "")
  .replace(/\s+/g, " ").trim();

/**
 * Parse text copied from a Slack help request. Handles the "Name  10:32 AM"
 * header Slack puts on a copied message, multi-line requests and thread noise.
 */
export function parseHelpRequest(text: string, createdBy: string): ParsedWo {
  const raw = stripMrkdwn((text || "").replace(/\r/g, "")).trim();
  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  let requester: string | null = null;

  // Slack copy formats: "Name  10:32 AM" on one line, or "Name" then "10:32 AM".
  if (lines.length) {
    const m = NAME_TIME_RE.exec(lines[0]);
    if (m && !/[.!?]$/.test(m[1])) { requester = m[1].trim(); lines.shift(); }
    else if (lines.length > 1 && TIME_RE.test(lines[1]) && lines[0].length <= 60 && !/[.!?]$/.test(lines[0])) { requester = lines[0]; lines.splice(0, 2); }
  }
  // Drop bare timestamps and reaction/thread noise anywhere in the paste.
  const body = lines.filter((l) => !STAMP_RE.test(l) && !/^\d+\s+repl(y|ies)$/i.test(l) && !/^(last reply|view thread)/i.test(l) && !/^:[a-z_+-]+:\d*$/i.test(l) && !/^the full request details/i.test(l.replace(EMOJI_RE, "")));

  const flat = body.join(" ").replace(/\s+/g, " ").trim();
  const guessed = detect(flat);

  // ── Slack workflow form ("🏢 New Facilities Help Request Submitted for Englewood Cliffs!" + labelled fields) ──
  const fields = parseFormFields(flat);
  if (fields.description || fields.category) {
    const site = requestSite(flat);
    if (fields.requester) requester = fields.requester.replace(/^@/, "");
    const description = fields.description || "";
    const locText = [fields.building, fields.room, fields.floor, description, site ?? ""].join(" ");
    const location = buildingFrom(locText) ?? (fields.building && !/englewood/i.test(fields.building) ? "Other" : "Other");
    const priority = fields.priority ? mapPriority(fields.priority, guessed.priority) : detect(description).priority;
    const type = fields.category ? mapType(fields.category, guessed.type) : detect(description).type;

    let title = cleanLine(description.split(/(?<=[.!?])\s+/)[0] || description) || [fields.category, fields.room || fields.floor].filter(Boolean).join(" — ") || "Facilities help request";
    if (title.length > 100) title = title.slice(0, 97) + "…";

    const where = [fields.building, fields.room && `Room ${fields.room}`, fields.floor && `Floor ${fields.floor}`].filter(Boolean).join(", ");
    const lines = [
      [fields.category, where].filter(Boolean).join(" · "),
      description,
      fields.notes,
      "",
      `Slack help request${site ? ` — ${site}` : ""}${fields.priority ? ` · Priority: ${fields.priority.replace(/\s*priority$/i, "")}` : ""}`,
      requester ? `Requested by ${requester}` : null,
    ].filter((l) => l !== null && l !== undefined).map((l) => (l as string).trim());
    const details = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    return { title, location, type, priority, status: "Open", details, created_by: createdBy, requester, site, fields };
  }

  const { location, type, priority } = guessed;
  let title = cleanLine(body[0] || "");
  if (title.length > 100) title = title.slice(0, 97) + "…";
  if (!title) title = "Work order from Slack";

  const details = [body.join("\n").trim(), requester ? `Requested by ${requester} (pasted from Slack)` : "Pasted from Slack"].filter(Boolean).join("\n\n");
  return { title, location, type, priority, status: "Open", details, created_by: createdBy, requester, site: requestSite(raw), fields };
}

/** Single-line Slack event text → work order (same rules the Railway portal used). */
export function parseSlackMessage(text: string, user: string): ParsedWo {
  const t = (text || "").replace(/\s+/g, " ").trim();
  const { location, type, priority } = detect(t);
  let title = cleanLine(t);
  if (!title) title = "Work order from Slack";
  if (title.length > 100) title = title.slice(0, 97) + "…";
  return { title, location, type, priority, status: "Open", details: t, created_by: user || "Slack", requester: null, site: null, fields: {} };
}

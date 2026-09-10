// Builds the PM checklist blocks for the selected equipment, interval and unit
// numbers — a direct port of renderPMChecklists() from the old PM sheet.
import {
  CT_PM, PUMP_PM, LIEBERT_PM, CO_PM, GENERIC_PM, MULTI_UNIT_EQUIP,
  EQUIPMENT_900, EQUIPMENT_904, EQUIPMENT_SHARED, type EquipmentGroups, type Frequency,
} from "./data";
import type { PmFormState } from "./types";

export type BlockPart =
  | { t: "freq"; text: string }
  | { t: "sub"; text: string }
  | { t: "task"; text: string; idx: number }
  | { t: "note"; text: string }
  | { t: "alert"; text: string }
  | { t: "readings"; labels: string[] };

export interface BlockDef {
  key: string;            // stable key for checks/findings/readings
  header: string;         // e.g. "❄️ Liebert Unit #7a — Monthly CAC PM"
  style: "ct" | "pump" | "liebert";
  parts: BlockPart[];
  findingsName: string;
}

export const isCT = (n: string) => n.startsWith("Cooling Tower");
export const isPump = (n: string) => n.startsWith("PCWP") || n.startsWith("SCWP") || n.startsWith("CHWP");
export const isLiebert = (n: string) => n === "Liebert Unit";
export const isCO = (n: string) => n === "CO Detectors";
export const isGeneric = (n: string) => Object.prototype.hasOwnProperty.call(GENERIC_PM, n);
export const isMultiUnit = (n: string) => MULTI_UNIT_EQUIP.has(n);

export const facilityCode = (facility: string) => facility.startsWith("900") ? "900" : facility.startsWith("904") ? "904" : null;

export function equipmentForFacility(facility: string): EquipmentGroups {
  const code = facilityCode(facility);
  if (!code) return {};
  return { ...(code === "900" ? EQUIPMENT_900 : EQUIPMENT_904), ...EQUIPMENT_SHARED };
}

const ORDER = ["Monthly", "Quarterly", "Semi-Annual", "Annual"];

const ctTasks = (f: string) => {
  const t: Record<string, string[]> = {};
  if (f !== "Monthly") {
    if (["Quarterly", "Semi-Annual", "Annual"].includes(f)) { t["Quarterly"] = CT_PM["Quarterly"]; t["Quarterly — VFD"] = CT_PM["Quarterly — VFD"]; }
    if (["Semi-Annual", "Annual"].includes(f)) t["Semi-Annual"] = CT_PM["Semi-Annual"];
    if (f === "Annual") t["Annual"] = CT_PM["Annual"];
  }
  return t;
};
const pumpTasks = (f: string) => {
  const t: Record<string, { tasks: string[]; note?: string }> = { Daily: PUMP_PM["Daily"] };
  if (["Quarterly", "Semi-Annual", "Annual"].includes(f)) t["Quarterly"] = PUMP_PM["Quarterly"];
  if (["Semi-Annual", "Annual"].includes(f)) t["Semi-Annual"] = PUMP_PM["Semi-Annual"];
  return t;
};
const liebertTasks = (f: string) => {
  const t: Record<string, (typeof LIEBERT_PM)[string]> = {};
  if (ORDER.includes(f)) t["Monthly"] = LIEBERT_PM["Monthly"];
  if (["Semi-Annual", "Annual"].includes(f)) t["Semi-Annual"] = LIEBERT_PM["Semi-Annual"];
  return t;
};
const coTasks = (f: string) => {
  const t: Record<string, string[]> = {};
  if (ORDER.includes(f)) t["Monthly"] = CO_PM["Monthly"];
  if (f === "Annual") t["Annual"] = CO_PM["Annual"];
  return t;
};
const genericTasks = (name: string, f: string) => {
  const pm = GENERIC_PM[name]; const t: Record<string, string[]> = {};
  if (!pm) return t;
  const fIdx = ORDER.indexOf(f);
  for (let i = 0; i <= fIdx; i++) if (pm.intervals[ORDER[i]]) t[ORDER[i]] = pm.intervals[ORDER[i]];
  return t;
};

export const liebertNames = (form: PmFormState) => form.liebertUnits.map((u, i) => "Liebert Unit #" + (u.num || `(${i + 1})`));
export const multiUnitNames = (form: PmFormState) => {
  const out: string[] = [];
  for (const [name, units] of Object.entries(form.equipUnits)) units.forEach((u, i) => out.push(`${name} #${u.num || `(${i + 1})`}`));
  return out;
};

/** "Cooling Tower 1, Liebert Unit #7a, FCU #3" — the equipment string for subject/record. */
export function equipmentList(form: PmFormState): string[] {
  let parts = form.selectedEquip.filter((n) => n !== "Liebert Unit" && !isMultiUnit(n));
  if (form.selectedEquip.includes("Liebert Unit")) parts = parts.concat(liebertNames(form));
  return parts.concat(multiUnitNames(form));
}

export function buildBlocks(form: PmFormState): BlockDef[] {
  const sel = form.selectedEquip; const f: Frequency = form.freq;
  const cts = sel.filter(isCT), pumps = sel.filter(isPump), hasLiebert = sel.some(isLiebert), cos = sel.filter(isCO), generics = sel.filter(isGeneric);
  const blocks: BlockDef[] = [];
  if (!cts.length && !pumps.length && !hasLiebert && !cos.length && !generics.length) return blocks;

  const liebertLabels = form.liebertUnits.map((u, i) => (u.num ? `Liebert Unit #${u.num}` : `Liebert Unit ${i + 1}`));
  const unitLabels = (name: string) => (form.equipUnits[name] || []).map((u, i) => `#${u.num || `(${i + 1})`}`);

  if (f === "Repair") {
    const repair = (key: string, label: string, style: BlockDef["style"]) => blocks.push({ key, header: `🔧 ${label} — Repair`, style, parts: [], findingsName: label });
    cts.forEach((n) => repair(`ct:${n}`, n, "ct"));
    pumps.forEach((n) => repair(`pump:${n}`, n, "pump"));
    if (hasLiebert) liebertLabels.forEach((l, i) => repair(`liebert:${i}`, l, "liebert"));
    cos.forEach((n) => repair(`co:${n}`, n, "ct"));
    generics.forEach((n) => {
      const units = unitLabels(n);
      if (isMultiUnit(n) && units.length) units.forEach((u, i) => repair(`gen:${n}:${i}`, `${n} ${u}`, "ct"));
      else repair(`gen:${n}`, n, "ct");
    });
    return blocks;
  }

  const taskParts = (groups: Record<string, string[]>) => {
    const parts: BlockPart[] = []; let idx = 0;
    for (const [label, tasks] of Object.entries(groups)) { parts.push({ t: "freq", text: label }); tasks.forEach((text) => parts.push({ t: "task", text, idx: idx++ })); }
    return parts;
  };

  const ct = ctTasks(f);
  if (Object.keys(ct).length) cts.forEach((n) => blocks.push({ key: `ct:${n}`, header: `🏗 ${n} — ${f} PM`, style: "ct", parts: taskParts(ct), findingsName: n }));

  if (pumps.length) {
    const pt = pumpTasks(f);
    pumps.forEach((n) => {
      const parts: BlockPart[] = []; let idx = 0;
      for (const [label, data] of Object.entries(pt)) {
        parts.push({ t: "freq", text: label });
        if (data.note) parts.push({ t: "note", text: data.note });
        data.tasks.forEach((text) => parts.push({ t: "task", text, idx: idx++ }));
      }
      blocks.push({ key: `pump:${n}`, header: `⚙️ ${n} — ${f} Paco Pump PM`, style: "pump", parts, findingsName: n });
    });
  }

  if (hasLiebert && form.liebertUnits.length) {
    const lt = liebertTasks(f);
    liebertLabels.forEach((label, i) => {
      const parts: BlockPart[] = []; let idx = 0;
      for (const [freq, data] of Object.entries(lt)) {
        parts.push({ t: "freq", text: freq });
        for (const sec of data.sections) {
          parts.push({ t: "sub", text: sec.sub });
          sec.tasks.forEach((text) => parts.push({ t: "task", text, idx: idx++ }));
          if (sec.alert) parts.push({ t: "alert", text: sec.alert });
          if (sec.hasHeaterReadings) parts.push({ t: "readings", labels: ["HTR #1 Amps", "HTR #2 Amps", "HTR #3 Amps"] });
          if (sec.hasMotorReadings) parts.push({ t: "readings", labels: ["L#1 Amps", "L#2 Amps", "L#3 Amps"] });
        }
      }
      blocks.push({ key: `liebert:${i}`, header: `❄️ ${label} — ${f} CAC PM`, style: "liebert", parts, findingsName: label });
    });
  }

  const co = coTasks(f);
  if (Object.keys(co).length) cos.forEach((n) => blocks.push({ key: `co:${n}`, header: `🔴 ${n} — ${f} PM`, style: "ct", parts: taskParts(co), findingsName: n }));

  const generic = (name: string, key: string, unitLabel: string) => {
    const pm = GENERIC_PM[name]; const tasks = genericTasks(name, f);
    if (!Object.keys(tasks).length) return;
    const parts = taskParts(tasks);
    if (pm.amps && pm.ampLabels?.length) { parts.push({ t: "freq", text: "Amp Readings" }); parts.push({ t: "readings", labels: pm.ampLabels.map((l) => `${l} Amps`) }); }
    blocks.push({ key, header: `🔧 ${name}${unitLabel ? " " + unitLabel : ""} — ${f} PM`, style: "ct", parts, findingsName: name + (unitLabel ? " " + unitLabel : "") });
  };
  generics.forEach((n) => {
    const units = unitLabels(n);
    if (isMultiUnit(n) && units.length) units.forEach((u, i) => generic(n, `gen:${n}:${i}`, u));
    else generic(n, `gen:${n}`, "");
  });
  return blocks;
}

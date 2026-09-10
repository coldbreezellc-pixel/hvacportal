"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { INVENTORY_GROUPS, type Item } from "@/lib/types";
import { addItem, updateItem, deleteItem, adjustQty, resetStock, batchUpdatePhotos, setItemPhoto, removeItemPhoto, sendEmail, flash } from "@/lib/store";
import { resizePhoto } from "@/lib/images";
import { useActiveGroup, setActiveGroup } from "./inventoryState";
import { ItemForm } from "./ItemForm";
import { Lightbox } from "./Lightbox";
import { EmailModal, type EmailDraft } from "./EmailModal";
import { S, F } from "./styles";

const REPORT_RECIPIENTS = process.env.NEXT_PUBLIC_REPORT_RECIPIENTS || "mateusz.targosz@versantmedia.com, sean.fanning@versantmedia.com";
const GROUP_ICONS: Record<string, string> = { "Plumbing": "🔧", "Faucet Parts": "🚿", "Air Filters 900": "🏢", "Air Filters 904": "🏗", "Electrical": "⚡", "HVAC": "❄️", "Lighting": "💡", "Hardware": "🔩", "Safety": "🦺", "Tools": "🛠", "AV/Tech": "📡", "Misc": "📦" };
const FILTER_COLS = "minmax(100px,1.5fr) 55px minmax(100px,1.5fr) 55px 45px 50px 50px 50px";
const FILTER_COLS_PHONE = "minmax(90px,1.4fr) minmax(90px,1.4fr) 44px 44px 50px";

// Phones get fewer columns so Stock and +/− are always on screen; the hidden
// columns are still shown when a row is expanded.
const phoneQuery = typeof window !== "undefined" ? window.matchMedia("(max-width: 640px)") : null;
const subscribePhone = (cb: () => void) => { phoneQuery?.addEventListener("change", cb); return () => phoneQuery?.removeEventListener("change", cb); };
const useIsPhone = () => useSyncExternalStore(subscribePhone, () => !!phoneQuery?.matches, () => false);

// ── Bing image thumbnails for part photos (free, no API key) — same as the original app ──
let imgFetching = false;
const fetchPartImage = async (partNumber: string, itemName: string) => {
  if (!partNumber) return null;
  try {
    const q = encodeURIComponent(partNumber.trim() + " " + (itemName || "").trim());
    const url = "https://tse1.mm.bing.net/th?q=" + q + "&w=120&h=120&c=7&rs=1&p=0";
    const res = await fetch(url);
    if (res.ok) { const blob = await res.blob(); if (blob.size > 1000) return url; }
  } catch { /* blocked or offline */ }
  return null;
};
const processImageQueue = async (items: Item[], onBatch: (u: Record<string, Partial<Item>>) => void) => {
  if (imgFetching) return;
  imgFetching = true;
  const updates: Record<string, Partial<Item>> = {};
  for (const item of items) {
    if (item.photo || item.photoFailed || !item.partNumber || !navigator.onLine) continue;
    await new Promise((r) => setTimeout(r, 300));
    const imgUrl = await fetchPartImage(item.partNumber, item.name);
    updates[item.id] = imgUrl ? { photo: imgUrl } : { photoFailed: true };
  }
  if (Object.keys(updates).length > 0) onBatch(updates);
  imgFetching = false;
};

const toBase64 = (s: string) => btoa(unescape(encodeURIComponent(s)));
const downloadCsv = (filename: string, csv: string) => {
  const blob = new Blob(["﻿" + csv], { type: "application/vnd.ms-excel;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
};
const orderQty = (i: Item) => { const t = i.totalNeeded || 0; return t > 0 ? Math.max(0, t * 2 - (i.qty || 0)) : 0; };

interface Props { allItems: Item[]; isAdmin: boolean; online: boolean }

export function InventoryView({ allItems, isAdmin, online }: Props) {
  const selectedGroup = useActiveGroup();
  const isPhone = useIsPhone();
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<"name" | "qty">("name");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Item | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirmDelItem, setConfirmDelItem] = useState<string | null>(null);
  const [inlineEdit, setInlineEdit] = useState<{ id: string; name: string; notes: string } | null>(null);
  const [editingQty, setEditingQty] = useState<{ id: string; value: string } | null>(null);
  const [engineers, setEngineers] = useState<string[]>([]);
  const [engInput, setEngInput] = useState("");
  const [inventoryDate, setInventoryDate] = useState(new Date().toISOString().slice(0, 10));
  const [lightbox, setLightbox] = useState<{ src: string; caption: string } | null>(null);
  const [emailDraft, setEmailDraft] = useState<EmailDraft | null>(null);
  const engInputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLDivElement>(null);

  const addEngineer = (name: string) => { const c = name.trim(); if (c && !engineers.includes(c)) setEngineers([...engineers, c]); };
  const removeEngineer = (idx: number) => setEngineers(engineers.filter((_, i) => i !== idx));
  const handleEngKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addEngineer(engInput.replace(/,/g, "")); setEngInput(""); }
    if (e.key === "Backspace" && !engInput && engineers.length > 0) removeEngineer(engineers.length - 1);
  };
  const handleEngBlur = () => { if (engInput.trim()) { addEngineer(engInput); setEngInput(""); } };

  const items = allItems
    .filter((i) => (i.group || "Misc") === selectedGroup)
    .filter((i) => {
      const q = search.toLowerCase();
      return !q || i.name.toLowerCase().includes(q) || (i.partNumber || "").toLowerCase().includes(q) || (i.unitId || "").toLowerCase().includes(q);
    })
    .sort((a, b) => (sortBy === "name" ? a.name.localeCompare(b.name) : (a.qty || 0) - (b.qty || 0)));

  // Auto-fetch Bing images for Plumbing & Faucet Parts items missing photos
  const photoFetchRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (online && (selectedGroup === "Plumbing" || selectedGroup === "Faucet Parts") && items.length > 0) {
      const needPhotos = items.filter((i) => !i.photo && !i.photoFailed && i.partNumber);
      if (needPhotos.length > 0 && !imgFetching) {
        if (photoFetchRef.current) clearTimeout(photoFetchRef.current);
        photoFetchRef.current = setTimeout(() => processImageQueue(needPhotos, batchUpdatePhotos), 500);
      }
    }
    return () => { if (photoFetchRef.current) clearTimeout(photoFetchRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedGroup, allItems, online]);

  useEffect(() => {
    if (showForm && formRef.current) setTimeout(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }, [showForm]);

  const dateStr = () => {
    const now = new Date();
    return inventoryDate ? new Date(inventoryDate + "T00:00:00").toLocaleDateString("en-US") : `${now.getMonth() + 1}/${now.getDate()}/${now.getFullYear()}`;
  };

  // ── Filter report (Air Filters) ──
  const buildFilterReport = () => {
    const groups: Record<string, Item[]> = {}; const order: string[] = [];
    items.forEach((i) => { if (!groups[i.name]) { groups[i.name] = []; order.push(i.name); } groups[i.name].push(i); });
    let csv = "FILTER INVENTORY REPORT\n";
    csv += "Building:," + (selectedGroup || "") + "\n";
    csv += "Date:," + dateStr() + "\n";
    csv += "Engineer(s):," + engineers.join("; ") + "\n\n";
    csv += "Unit ID,Units,Filter Size,Per Unit,Total,In Stock,Order\n";
    order.forEach((filterSize) => {
      const grp = groups[filterSize];
      grp.forEach((i) => {
        csv += '"' + (i.unitId || "").replace(/,/g, ";") + '",' + (i.qtyUnits ?? "") + "," + i.name + "," + (i.qtyPerUnit ?? "") + "," + (i.totalNeeded || 0) + "," + (i.qty || 0) + "," + orderQty(i) + "\n";
      });
      csv += ",,,SUBTOTAL: " + filterSize + "," + grp.reduce((s, i) => s + (i.totalNeeded || 0), 0) + "," + grp.reduce((s, i) => s + (i.qty || 0), 0) + "," + grp.reduce((s, i) => s + orderQty(i), 0) + "\n";
    });
    const filename = "Filter_Inventory_" + (selectedGroup || "Filters").replace(/\s/g, "_") + "_" + new Date().toISOString().slice(0, 10) + ".csv";
    return { csv, filename };
  };

  // ── Parts report (everything else) ──
  const buildInventoryReport = () => {
    let csv = "INVENTORY REPORT\n";
    csv += "Category:," + (selectedGroup || "") + "\n";
    csv += "Date:," + dateStr() + "\n";
    csv += "Engineer(s):," + engineers.join("; ") + "\n\n";
    csv += "Item,Part #,Description,Stock\n";
    items.forEach((i) => { csv += '"' + (i.name || "").replace(/,/g, ";") + '",' + (i.partNumber || "") + ',"' + (i.notes || "").replace(/,/g, ";") + '",' + (i.qty || 0) + "\n"; });
    const totalStock = items.reduce((s, i) => s + (i.qty || 0), 0);
    csv += "\n,,TOTAL ITEMS:," + items.length + "\n,,TOTAL STOCK:," + totalStock + "\n";
    const filename = (selectedGroup || "Inventory").replace(/\s/g, "_") + "_Inventory_" + new Date().toISOString().slice(0, 10) + ".csv";
    return { csv, filename, totalStock };
  };

  const openReport = () => {
    if (engineers.length === 0) { flash("Please add at least one engineer name.", "err"); return; }
    if (isFilterGroup) {
      const { csv, filename } = buildFilterReport();
      setEmailDraft({
        to: REPORT_RECIPIENTS, filename, csv,
        subject: `${selectedGroup} — Filter Inventory — ${engineers.join(", ")} — ${dateStr()}`,
        text: `Please find attached the filter inventory report.\n\nBuilding: ${selectedGroup}\nEngineer(s): ${engineers.join(", ")}\nDate: ${dateStr()}`,
      });
    } else {
      const { csv, filename, totalStock } = buildInventoryReport();
      setEmailDraft({
        to: REPORT_RECIPIENTS, filename, csv,
        subject: `${selectedGroup} — Inventory Report — ${engineers.join(", ")} — ${dateStr()}`,
        text: `Please find attached the inventory report.\n\nCategory: ${selectedGroup}\nEngineer(s): ${engineers.join(", ")}\nDate: ${dateStr()}\nTotal Items: ${items.length}\nTotal Stock: ${totalStock}`,
      });
    }
  };

  const handlePhotoFile = async (item: Item, file: File | undefined) => {
    if (!file) return;
    try { setItemPhoto(item.id, await resizePhoto(file)); }
    catch (e) { flash(e instanceof Error ? e.message : "Could not read that photo.", "err"); }
  };

  const openGroup = (g: string) => { setActiveGroup(g); setSearch(""); setExpanded(null); };
  const goBack = () => { setActiveGroup(null); setShowForm(false); setEditing(null); setExpanded(null); setSearch(""); };

  // ── GROUP LANDING PAGE ──
  if (!selectedGroup) {
    const groupsWithItems = INVENTORY_GROUPS.filter((g) => allItems.some((i) => (i.group || "Misc") === g));
    const extraGroups = [...new Set(allItems.map((i) => i.group || "Misc"))].filter((g) => !INVENTORY_GROUPS.includes(g));
    const allGroups = [...groupsWithItems, ...extraGroups];
    return (
      <div className="pg-page">
        <h2 style={S.pageTitle}>Inventory</h2>
        <div className="pg-groups-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {allGroups.map((g) => {
            const groupItems = allItems.filter((i) => (i.group || "Misc") === g);
            const totalUnits = groupItems.reduce((s, i) => s + (i.qty || 0), 0);
            const outOfStock = groupItems.filter((i) => (i.qty || 0) === 0).length;
            return (
              <button key={g} onClick={() => openGroup(g)} style={{ background: "#ffffff", border: "1.5px solid #e2e8f0", borderRadius: 14, padding: "20px 16px", cursor: "pointer", textAlign: "left", transition: "all .2s", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                <div style={{ fontSize: 28, marginBottom: 8 }}>{GROUP_ICONS[g] || "📦"}</div>
                <div style={{ fontFamily: F.heading, fontSize: 15, color: "#0f172a", fontWeight: 700, marginBottom: 4 }}>{g}</div>
                <div style={{ fontFamily: F.body, fontSize: 12, color: "#64748b" }}>{groupItems.length} items · {totalUnits} units</div>
                {outOfStock > 0 && <div style={{ fontFamily: F.body, fontSize: 11, color: "#ef4444", marginTop: 3 }}>{outOfStock} out of stock</div>}
              </button>
            );
          })}
          {allGroups.length === 0 && <p style={{ fontFamily: F.body, fontSize: 13, color: "#64748b", gridColumn: "1 / -1" }}>No items yet. {isAdmin ? "Run the seed script or add items." : ""}</p>}
        </div>
        <div style={{ height: 80 }} />
      </div>
    );
  }

  // ── ITEM LIST FOR SELECTED GROUP ──
  const isFilterGroup = selectedGroup.startsWith("Air Filters");
  const hasPhotos = !isFilterGroup; // every parts group can carry photos
  const gridCols = isPhone
    ? "44px minmax(90px,1.6fr) minmax(64px,1fr) 44px 50px"
    : hasPhotos ? "50px minmax(100px,1.5fr) minmax(70px,1fr) minmax(80px,1.2fr) 50px 50px" : "minmax(120px,2fr) minmax(80px,1fr) minmax(100px,1.5fr) 50px 50px";
  const headers = isPhone ? ["Photo", "Item", "Part #", "Stock", "+/−"] : hasPhotos ? ["Photo", "Item", "Part #", "Description", "Stock", "+/−"] : ["Item", "Part #", "Description", "Stock", "+/−"];
  const minW = isPhone ? 0 : hasPhotos ? 470 : 420;
  const filterCols = isPhone ? FILTER_COLS_PHONE : FILTER_COLS;
  const filterHeaders = isPhone ? ["Unit ID", "Filter Size", "Stock", "Order", "+/−"] : ["Unit ID", "Units", "Filter Size", "Per Unit", "Total", "Stock", "Order", "+/−"];
  const filterMinW = isPhone ? 0 : 560;

  const qtyCell = (i: Item, color: string) => editingQty?.id === i.id ? (
    <div style={{ textAlign: "center" }} onClick={(e) => e.stopPropagation()}>
      <input type="number" min="0" autoFocus inputMode="numeric" style={S.qtyInput} value={editingQty.value}
        onChange={(e) => setEditingQty({ ...editingQty, value: e.target.value })}
        onBlur={() => { const v = Math.max(0, parseInt(editingQty.value, 10) || 0); if (v !== i.qty) updateItem(i.id, { qty: v }, { toast: false }); setEditingQty(null); }}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
    </div>
  ) : (
    <div style={{ fontFamily: F.mono, fontSize: 13, textAlign: "center", fontWeight: 700, color, cursor: "pointer" }}
      onClick={(e) => { e.stopPropagation(); setEditingQty({ id: i.id, value: String(i.qty || 0) }); }}>{i.qty || 0}</div>
  );

  const plusMinus = (i: Item) => (
    <div style={{ display: "flex", gap: 2, justifyContent: "center" }} onClick={(e) => e.stopPropagation()}>
      <button style={S.qtyBtnSm} aria-label="Decrease" onClick={() => adjustQty(i.id, -1)}>−</button>
      <button style={S.qtyBtnSm} aria-label="Increase" onClick={() => adjustQty(i.id, 1)}>+</button>
    </div>
  );

  const adminActions = (i: Item) => (
    <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
      {isAdmin && <button style={S.btnSecondary} onClick={() => setInlineEdit({ id: i.id, name: i.name, notes: i.notes || "" })}>✏️ Edit</button>}
      {isAdmin && <button style={S.btnSecondary} onClick={() => { setEditing(i); setShowForm(true); }}>Full Edit</button>}
      {isAdmin && confirmDelItem !== i.id && <button style={S.btnDel} onClick={() => setConfirmDelItem(i.id)}>Delete</button>}
      {isAdmin && confirmDelItem === i.id && (
        <>
          <button style={S.btnDel} onClick={() => { deleteItem(i.id); setConfirmDelItem(null); setExpanded(null); }}>Yes, Delete</button>
          <button style={S.btnSecondary} onClick={() => setConfirmDelItem(null)}>Cancel</button>
        </>
      )}
    </div>
  );

  const inlineEditor = (i: Item, nameLabel: string, notesLabel: string) => (
    <>
      <label style={S.label}>{nameLabel}</label>
      <input style={S.input} value={inlineEdit!.name} onChange={(e) => setInlineEdit({ ...inlineEdit!, name: e.target.value })} />
      <label style={S.label}>{notesLabel}</label>
      <textarea style={{ ...S.input, minHeight: 50, resize: "vertical", marginBottom: 0 }} value={inlineEdit!.notes} onChange={(e) => setInlineEdit({ ...inlineEdit!, notes: e.target.value })} placeholder="Add notes…" />
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button style={{ ...S.btnPrimary, width: "auto", padding: "8px 16px" }} onClick={() => { if (inlineEdit!.name.trim()) { updateItem(i.id, { name: inlineEdit!.name, notes: inlineEdit!.notes }); setInlineEdit(null); } }}>Save</button>
        <button style={S.btnSecondary} onClick={() => setInlineEdit(null)}>Cancel</button>
      </div>
    </>
  );

  const engineerInput = (chipBg: string, chipBorder: string, chipColor: string) => (
    <div style={{ border: "1.5px solid #e2e8f0", borderRadius: 10, background: "#fff", padding: "6px 8px", display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", minHeight: 44, cursor: "text" }} onClick={() => engInputRef.current?.focus()}>
      {engineers.map((name, idx) => (
        <span key={idx} style={{ display: "inline-flex", alignItems: "center", gap: 4, background: chipBg, border: `1px solid ${chipBorder}`, borderRadius: 6, padding: "4px 8px", fontFamily: F.body, fontSize: 13, fontWeight: 600, color: chipColor }}>
          {name}
          <button onClick={(e) => { e.stopPropagation(); removeEngineer(idx); }} style={{ width: 18, height: 18, borderRadius: "50%", border: "none", background: "rgba(13,148,136,0.15)", color: chipColor, fontSize: 11, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1 }}>✕</button>
        </span>
      ))}
      <input ref={engInputRef} value={engInput} onChange={(e) => setEngInput(e.target.value)} onKeyDown={handleEngKey} onBlur={handleEngBlur}
        placeholder={engineers.length ? "Add another…" : "Type name, press Enter…"}
        style={{ border: "none", outline: "none", background: "transparent", fontFamily: F.body, fontSize: 14, color: "#1e293b", flex: 1, minWidth: 120, padding: "4px 0" }}
        autoCapitalize="words" autoCorrect="off" spellCheck={false} />
    </div>
  );

  const resetButton = isAdmin && (
    <button style={S.btnDanger} onClick={() => {
      if (confirm("⚠️ Reset ALL stock quantities to 0 for " + selectedGroup + "?\n\nThis cannot be undone.")) resetStock(new Set(items.map((i) => i.id)), selectedGroup);
    }}>🗑 Reset All Stock to Zero</button>
  );

  return (
    <div className="pg-page">
      {lightbox && <Lightbox src={lightbox.src} caption={lightbox.caption} onClose={() => setLightbox(null)} />}
      {emailDraft && (
        <EmailModal draft={emailDraft} onClose={() => setEmailDraft(null)}
          onDownload={() => downloadCsv(emailDraft.filename, emailDraft.csv)}
          onSend={(d) => {
            sendEmail({ to: d.to.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean), subject: d.subject, text: d.text, attachments: [{ filename: d.filename, content: toBase64("﻿" + d.csv), contentType: "text/csv" }] });
            setEmailDraft(null);
          }} />
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <button onClick={goBack} aria-label="Back" style={{ background: "none", border: "none", color: "#0d9488", fontSize: 24, cursor: "pointer", fontWeight: 700, padding: "4px 0", lineHeight: 1 }}>←</button>
        <h2 style={{ ...S.pageTitle, margin: 0, flex: 1 }}>{selectedGroup}</h2>
        <button style={{ ...S.btnPrimary, width: "auto", padding: "8px 16px" }} onClick={() => { setEditing(null); setShowForm(true); }}>+ Add</button>
      </div>

      <input style={S.input} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search items, filter size, or unit…" />

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8, marginBottom: 4 }}>
        <label style={{ ...S.label, margin: 0, whiteSpace: "nowrap" }}>Date</label>
        <input type="date" style={{ ...S.input, flex: 1, marginBottom: 0 }} value={inventoryDate} onChange={(e) => setInventoryDate(e.target.value)} />
      </div>

      {isFilterGroup && (
        <div style={{ marginTop: 8, marginBottom: 12 }}>
          <label style={{ ...S.label, marginBottom: 4 }}>Engineer(s) performing inventory</label>
          {engineerInput("#f0fdfa", "#99f6e4", "#0d9488")}
        </div>
      )}

      {!isFilterGroup && (
        <div style={{ display: "flex", gap: 8, marginBottom: 12, marginTop: 6 }}>
          <select style={S.select} value={sortBy} onChange={(e) => setSortBy(e.target.value as "name" | "qty")}>
            <option value="name">Sort: Name</option>
            <option value="qty">Sort: Qty</option>
          </select>
          <span style={{ fontFamily: F.body, fontSize: 12, color: "#64748b", display: "flex", alignItems: "center" }}>{items.length} items</span>
        </div>
      )}

      {showForm && (
        <div ref={formRef}>
          <ItemForm item={editing} activeGroup={selectedGroup} onSave={(data) => {
            if (editing) updateItem(editing.id, data); else addItem(data, selectedGroup);
            setShowForm(false); setEditing(null);
          }} onCancel={() => { setShowForm(false); setEditing(null); }} />
        </div>
      )}

      {/* ── SPREADSHEET VIEW FOR AIR FILTERS ── */}
      {isFilterGroup && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontFamily: F.body, fontSize: 12, color: "#64748b", marginBottom: 10 }}>{items.length} filters</div>
          <div className="pg-table-scroll" style={{ border: "1px solid #e2e8f0", borderRadius: 8, overflow: "hidden", overflowX: "auto" }}>
            <div style={{ display: "grid", gridTemplateColumns: filterCols, background: "#f1f5f9", padding: "6px 8px", borderBottom: "2px solid #cbd5e1", gap: 4, minWidth: filterMinW }}>
              {filterHeaders.map((h) => (
                <span key={h} style={{ fontFamily: F.heading, fontSize: 9, color: "#475569", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".3px", textAlign: h === "Unit ID" || h === "Filter Size" ? "left" : "center" }}>{h}</span>
              ))}
            </div>
            {(() => {
              const seen: Record<string, Item[]> = {}; const groups: string[] = [];
              items.forEach((i) => { if (!seen[i.name]) { seen[i.name] = []; groups.push(i.name); } seen[i.name].push(i); });
              let rowIdx = 0;
              return groups.map((filterSize) => {
                const groupItems = seen[filterSize];
                const sumTotal = groupItems.reduce((s, i) => s + (i.totalNeeded || 0), 0);
                const sumStock = groupItems.reduce((s, i) => s + (i.qty || 0), 0);
                const sumOrder = groupItems.reduce((s, i) => s + orderQty(i), 0);
                return (
                  <div key={filterSize}>
                    {groupItems.map((i) => {
                      const total = i.totalNeeded || 0; const stock = i.qty || 0; const order = orderQty(i);
                      const isLow = total > 0 && stock < total; const isOut = total > 0 && stock === 0;
                      const rowBg = rowIdx % 2 === 0 ? "#fff" : "#fafbfc"; rowIdx++;
                      return (
                        <div key={i.id}>
                          <div style={{ display: "grid", gridTemplateColumns: filterCols, padding: "8px 8px", borderBottom: "1px solid #f1f5f9", alignItems: "start", background: expanded === i.id ? "#f0fdfa" : rowBg, cursor: "pointer", gap: 4, minWidth: filterMinW }}
                            onClick={() => setExpanded(expanded === i.id ? null : i.id)}>
                            <div style={{ fontFamily: F.body, fontSize: 12, color: "#334155", fontWeight: 600, lineHeight: 1.4, wordBreak: "break-word" }}>
                              {(i.unitId || "—").split(/,\s*/).map((unit, ui) => <div key={ui} style={{ padding: "1px 0" }}>{unit.trim()}</div>)}
                            </div>
                            {!isPhone && <div style={{ fontFamily: F.mono, fontSize: 12, color: "#64748b", textAlign: "center" }}>{i.qtyUnits ?? "—"}</div>}
                            <div style={{ fontFamily: F.heading, fontSize: 12, color: "#0f172a", fontWeight: 600 }}>{i.name}{isPhone && total ? <div style={{ fontFamily: F.mono, fontSize: 10, color: "#64748b", fontWeight: 500 }}>need {total}</div> : null}</div>
                            {!isPhone && <div style={{ fontFamily: F.mono, fontSize: typeof i.qtyPerUnit === "string" && i.qtyPerUnit.includes("/") ? 10 : 12, color: "#64748b", textAlign: "center", lineHeight: 1.2 }}>{i.qtyPerUnit || "—"}</div>}
                            {!isPhone && <div style={{ fontFamily: F.mono, fontSize: 13, color: "#334155", textAlign: "center", fontWeight: 700 }}>{total || "—"}</div>}
                            {qtyCell(i, isOut ? "#ef4444" : isLow ? "#f59e0b" : "#16a34a")}
                            <div style={{ fontFamily: F.mono, fontSize: 13, textAlign: "center", fontWeight: 700, color: order > 0 ? "#dc2626" : "#94a3b8", background: order > 0 ? "#fef2f2" : "transparent", borderRadius: 4, padding: "2px 0" }}>{order || "—"}</div>
                            {plusMinus(i)}
                          </div>
                          {expanded === i.id && (
                            <div style={{ padding: "10px 12px 14px", background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                              {inlineEdit?.id === i.id ? inlineEditor(i, "Filter Size (Name)", "Notes") : (
                                <>
                                  <p style={S.detailLine}><b>Unit ID:</b> {i.unitId || "—"}</p>
                                  <p style={S.detailLine}><b># of Units:</b> {i.qtyUnits ?? "—"}</p>
                                  <p style={S.detailLine}><b>Filter Size:</b> {i.name}</p>
                                  <p style={S.detailLine}><b>Qty Per Unit:</b> {i.qtyPerUnit || "—"}</p>
                                  <p style={S.detailLine}><b>Total Needed:</b> {total}</p>
                                  <p style={S.detailLine}><b>In Stock:</b> {stock}</p>
                                  <p style={S.detailLine}><b>Order (Total×2 − Stock):</b> <span style={{ color: order > 0 ? "#dc2626" : "#16a34a", fontWeight: 700 }}>{order}</span></p>
                                  {i.notes && <p style={S.detailLine}><b>Notes:</b> {i.notes}</p>}
                                  <p style={S.detailLine}><b>Last updated:</b> {new Date(i.lastUpdated).toLocaleDateString()} {i.updatedBy ? `by ${i.updatedBy}` : ""}</p>
                                  {adminActions(i)}
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                    <div style={{ display: "grid", gridTemplateColumns: filterCols, padding: "6px 8px", background: "#1e293b", gap: 4, minWidth: filterMinW, borderBottom: "3px solid #0d9488" }}>
                      <div style={{ gridColumn: isPhone ? "1 / 3" : "1 / 4", fontFamily: F.heading, fontSize: 11, color: "#94a3b8", fontWeight: 700 }}>SUBTOTAL: {filterSize}{isPhone ? ` · need ${sumTotal}` : ""}</div>
                      {!isPhone && <div></div>}
                      {!isPhone && <div style={{ fontFamily: F.mono, fontSize: 12, color: "#fff", textAlign: "center", fontWeight: 800 }}>{sumTotal}</div>}
                      <div style={{ fontFamily: F.mono, fontSize: 12, color: "#4ade80", textAlign: "center", fontWeight: 800 }}>{sumStock}</div>
                      <div style={{ fontFamily: F.mono, fontSize: 12, color: sumOrder > 0 ? "#f87171" : "#4ade80", textAlign: "center", fontWeight: 800 }}>{sumOrder || "—"}</div>
                      <div></div>
                    </div>
                  </div>
                );
              });
            })()}
          </div>
          {items.length === 0 && <p style={{ fontFamily: F.body, fontSize: 13, color: "#64748b", textAlign: "center", padding: 32 }}>No filters in this group{search ? " matching your search" : ""}.</p>}
          <button style={S.btnExport} onClick={openReport}>📧 Export & Email Report</button>
          {resetButton}
          <div style={{ height: 80 }} />
        </div>
      )}

      {/* ── SPREADSHEET VIEW FOR PARTS GROUPS ── */}
      {!isFilterGroup && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontFamily: F.body, fontSize: 12, color: "#64748b", marginBottom: 10 }}>{items.length} items</div>
          <div className="pg-table-scroll" style={{ border: "1px solid #e2e8f0", borderRadius: 8, overflow: "hidden", overflowX: "auto" }}>
            <div style={{ display: "grid", gridTemplateColumns: gridCols, background: "#f1f5f9", padding: "6px 8px", borderBottom: "2px solid #cbd5e1", gap: 4, minWidth: minW }}>
              {headers.map((h) => (
                <span key={h} style={{ fontFamily: F.heading, fontSize: 9, color: "#475569", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".3px", textAlign: ["Item", "Part #", "Description", "Photo"].includes(h) ? "left" : "center" }}>{h}</span>
              ))}
            </div>
            {items.map((i, idx) => {
              const stock = i.qty || 0;
              const rowBg = idx % 2 === 0 ? "#fff" : "#fafbfc";
              const googleUrl = i.partNumber ? "https://www.google.com/search?tbm=isch&q=" + encodeURIComponent(i.partNumber + " " + (i.name || "")) : "";
              return (
                <div key={i.id}>
                  <div style={{ display: "grid", gridTemplateColumns: gridCols, padding: "6px 8px", borderBottom: "1px solid #f1f5f9", alignItems: "center", background: expanded === i.id ? "#f0fdfa" : rowBg, cursor: "pointer", gap: 4, minWidth: minW }}
                    onClick={() => setExpanded(expanded === i.id ? null : i.id)}>
                    {hasPhotos && (
                      <div style={{ width: isPhone ? 40 : 44, height: isPhone ? 40 : 44, borderRadius: 6, overflow: "hidden", background: "#f1f5f9", border: "1.5px solid #e2e8f0", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, cursor: i.photo ? "zoom-in" : "pointer" }}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (i.photo) setLightbox({ src: i.photoFull || i.photo, caption: `${i.name}${i.partNumber ? " · #" + i.partNumber : ""}` });
                          else if (googleUrl) window.open(googleUrl, "_blank");
                        }}>
                        {i.photo ? (
                          <img src={i.photo} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }}
                            onError={(e) => { const t = e.currentTarget; t.style.display = "none"; if (t.parentElement) t.parentElement.textContent = "📷"; }} />
                        ) : (
                          <span style={{ fontSize: 16, color: "#94a3b8" }}>{i.partNumber ? (i.photoFailed ? "📷" : "⏳") : "—"}</span>
                        )}
                      </div>
                    )}
                    <div style={{ fontFamily: F.heading, fontSize: 12, color: "#0f172a", fontWeight: 600, lineHeight: 1.3, wordBreak: "break-word" }}>{i.name}</div>
                    <div style={{ fontFamily: F.mono, fontSize: 11, color: "#64748b", wordBreak: "break-word" }}>{i.partNumber || "—"}</div>
                    {!isPhone && <div style={{ fontFamily: F.body, fontSize: 11, color: "#64748b", lineHeight: 1.3 }}>{i.notes || "—"}</div>}
                    {qtyCell(i, stock === 0 ? "#ef4444" : stock <= (i.minQty || 0) && (i.minQty || 0) > 0 ? "#f59e0b" : "#16a34a")}
                    {plusMinus(i)}
                  </div>
                  {expanded === i.id && (
                    <div style={{ padding: "10px 12px 14px", background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                      {inlineEdit?.id === i.id ? inlineEditor(i, "Name", "Description / Notes") : (
                        <>
                          <div style={{ marginBottom: 10 }}>
                            {i.photo && (
                              <div style={{ marginBottom: 8 }}>
                                <img src={i.photo} alt="" style={{ width: "100%", maxWidth: 200, borderRadius: 8, border: "1px solid #e2e8f0", cursor: "zoom-in" }}
                                  onClick={() => setLightbox({ src: i.photoFull || i.photo!, caption: `${i.name}${i.partNumber ? " · #" + i.partNumber : ""}` })} />
                              </div>
                            )}
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                              <label style={{ ...S.btnSecondary, display: "inline-flex", alignItems: "center", gap: 4, margin: 0, cursor: "pointer" }}>
                                📷 {i.photo ? "Change" : "Add"} Photo
                                <input type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={(e) => { void handlePhotoFile(i, e.target.files?.[0]); e.target.value = ""; }} />
                              </label>
                              {i.partNumber && (
                                <a href={googleUrl} target="_blank" rel="noopener noreferrer" style={{ ...S.btnSecondary, display: "inline-flex", alignItems: "center", gap: 4, textDecoration: "none", color: "#0d9488" }}>🔍 Google #{i.partNumber}</a>
                              )}
                              {isAdmin && i.photo && <button style={S.btnDel} onClick={() => removeItemPhoto(i.id)}>✕ Remove</button>}
                            </div>
                          </div>
                          {i.partNumber && <p style={S.detailLine}><b>Part #:</b> {i.partNumber}</p>}
                          {i.location && <p style={S.detailLine}><b>Location:</b> {i.location}</p>}
                          {i.minQty > 0 && <p style={S.detailLine}><b>Min stock:</b> {i.minQty}</p>}
                          {i.notes && <p style={S.detailLine}><b>Notes:</b> {i.notes}</p>}
                          <p style={S.detailLine}><b>Last updated:</b> {new Date(i.lastUpdated).toLocaleDateString()} {i.updatedBy ? `by ${i.updatedBy}` : ""}</p>
                          {adminActions(i)}
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {items.length === 0 && <p style={{ fontFamily: F.body, fontSize: 13, color: "#64748b", textAlign: "center", padding: 32 }}>No items in this group{search ? " matching your search" : ""}.</p>}

          <div style={{ marginTop: 16, padding: "12px", background: "#f8fafc", borderRadius: 10, border: "1px solid #e2e8f0" }}>
            <label style={S.label}>Engineer(s) performing inventory</label>
            {engineerInput("#e0f2fe", "#7dd3fc", "#0c4a6e")}
          </div>
          <button style={S.btnExport} onClick={openReport}>📧 Export & Email Report</button>
          {resetButton}
          <div style={{ height: 80 }} />
        </div>
      )}
    </div>
  );
}

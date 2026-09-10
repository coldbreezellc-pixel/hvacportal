"use client";
import type { Photo } from "@/lib/types";
import { resizePhoto } from "@/lib/images";
import { flash } from "@/lib/store";
import { F } from "./styles";

interface Props {
  photos: Photo[];
  onAdd?: (photos: Photo[]) => void;      // omit to make the grid read-only
  onRemove?: (index: number) => void;
  onOpen: (photo: Photo) => void;
  size?: number;
}

/** 3-up thumbnail grid with camera/gallery add and remove. Tap a photo to open it. */
export function PhotoGrid({ photos, onAdd, onRemove, onOpen, size = 84 }: Props) {
  const handleFiles = async (files: FileList | null) => {
    if (!files || !files.length || !onAdd) return;
    const out: Photo[] = [];
    for (const f of Array.from(files).slice(0, 10)) {
      try { out.push(await resizePhoto(f)); } catch { flash("Could not read one of the photos.", "err"); }
    }
    if (out.length) onAdd(out);
  };
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
      {photos.map((p, i) => (
        <div key={i} style={{ position: "relative", width: size, height: size, borderRadius: 8, overflow: "hidden", border: "1.5px solid #e2e8f0", background: "#f8fafc" }}>
          <img src={p.thumb} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", cursor: "zoom-in" }} onClick={() => onOpen(p)} />
          {onRemove && (
            <button type="button" aria-label="Remove photo" onClick={() => onRemove(i)}
              style={{ position: "absolute", top: 3, right: 3, width: 22, height: 22, borderRadius: "50%", border: "none", background: "rgba(220,38,38,.9)", color: "#fff", fontSize: 12, cursor: "pointer", lineHeight: 1 }}>✕</button>
          )}
          {p.thumb.startsWith("data:") && <span title="Uploads when online" style={{ position: "absolute", left: 3, bottom: 3, fontSize: 10, background: "rgba(15,23,42,.7)", color: "#fde68a", padding: "1px 5px", borderRadius: 6, fontFamily: F.body, fontWeight: 700 }}>queued</span>}
        </div>
      ))}
      {onAdd && (
        <label style={{ width: size, height: size, border: "1.5px dashed #cbd5e1", borderRadius: 8, background: "#f8fafc", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#64748b", fontFamily: F.body, fontSize: 11, gap: 2 }}>
          <span style={{ fontSize: 20 }}>📷</span>Add
          <input type="file" accept="image/*" multiple style={{ display: "none" }} onChange={(e) => { void handleFiles(e.target.files); e.target.value = ""; }} />
        </label>
      )}
    </div>
  );
}

"use client";
import { useEffect } from "react";
import { F } from "./styles";

/** Full-screen photo popup. Tap anywhere or press Esc to close. */
export function Lightbox({ src, caption, onClose }: { src: string; caption?: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  return (
    <div role="dialog" aria-modal="true" onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(2,6,23,0.92)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 16, cursor: "zoom-out" }}>
      <img src={src} alt={caption || ""} style={{ maxWidth: "100%", maxHeight: "82vh", borderRadius: 10, boxShadow: "0 20px 60px rgba(0,0,0,0.5)", objectFit: "contain" }} />
      {caption && <p style={{ fontFamily: F.body, color: "#e2e8f0", fontSize: 14, marginTop: 12, textAlign: "center" }}>{caption}</p>}
      <button onClick={onClose} aria-label="Close" style={{ position: "fixed", top: 14, right: 14, width: 40, height: 40, borderRadius: "50%", border: "none", background: "rgba(255,255,255,0.15)", color: "#fff", fontSize: 20, cursor: "pointer" }}>✕</button>
    </div>
  );
}

"use client";
import { useEffect, useRef } from "react";
import { F } from "../styles";

interface Props {
  value: string | null;                 // PNG data URL of the current drawing (restored from a draft)
  onChange: (dataUrl: string | null) => void;
  disabled?: boolean;
  height?: number;
  placeholder?: string;
}

/** Finger/mouse signature pad. Emits a PNG data URL after each stroke. */
export function SignaturePad({ value, onChange, disabled, height = 110, placeholder = "Sign here with your finger" }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef({ x: 0, y: 0 });
  const hasInk = useRef(!!value);

  // Size the canvas to its box (2× for crisp lines) and restore any saved drawing.
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 10) return;
    canvas.width = rect.width * 2; canvas.height = rect.height * 2;
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    ctx.scale(2, 2); ctx.strokeStyle = "#1B3A5C"; ctx.lineWidth = 2.5; ctx.lineCap = "round"; ctx.lineJoin = "round";
    if (value) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0, rect.width, rect.height);
      img.src = value;
      hasInk.current = true;
    } else {
      hasInk.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value === null]);

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return;
    e.preventDefault();
    canvasRef.current?.setPointerCapture(e.pointerId);
    drawing.current = true; last.current = pos(e);
    const ctx = canvasRef.current!.getContext("2d")!;
    ctx.beginPath(); ctx.arc(last.current.x, last.current.y, 1, 0, Math.PI * 2); ctx.fillStyle = "#1B3A5C"; ctx.fill();
    hasInk.current = true;
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || disabled) return;
    e.preventDefault();
    const p = pos(e); const ctx = canvasRef.current!.getContext("2d")!;
    ctx.beginPath(); ctx.moveTo(last.current.x, last.current.y); ctx.lineTo(p.x, p.y); ctx.stroke();
    last.current = p;
  };
  const end = () => {
    if (!drawing.current) return;
    drawing.current = false;
    onChange(canvasRef.current!.toDataURL("image/png"));
  };

  return (
    <div style={{ position: "relative", border: "2px dashed #cbd5e1", borderRadius: 10, background: "#fff", height, touchAction: "none", opacity: disabled ? 0.7 : 1 }}>
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block", borderRadius: 10 }}
        onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onPointerLeave={end} />
      {!value && !hasInk.current && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none", fontFamily: F.body, fontSize: 13, color: "#94a3b8" }}>✍️ {placeholder}</div>
      )}
    </div>
  );
}

/**
 * FloatingWindow — draggable, resizable floating panel.
 *
 * Renders as a portal on top of all content.
 * Drag via title bar, resize via bottom-right handle.
 * Remembers position within the viewport.
 */
import { useState, useRef, useCallback, useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Minimize2 } from "lucide-react";

interface FloatingWindowProps {
  title: ReactNode;
  children: ReactNode;
  onClose: () => void;
  /** Initial width in px */
  initialWidth?: number;
  /** Initial height in px */
  initialHeight?: number;
  /** Minimum width */
  minWidth?: number;
  /** Minimum height */
  minHeight?: number;
  /** Icon to show in title bar */
  icon?: ReactNode;
}

export function FloatingWindow({
  title,
  children,
  onClose,
  initialWidth = 520,
  initialHeight = 420,
  minWidth = 360,
  minHeight = 280,
  icon,
}: FloatingWindowProps) {
  // Position state — center initially
  const [pos, setPos] = useState(() => ({
    x: Math.max(40, Math.floor((window.innerWidth - initialWidth) / 2)),
    y: Math.max(40, Math.floor((window.innerHeight - initialHeight) / 2)),
  }));
  const [size, setSize] = useState({ w: initialWidth, h: initialHeight });

  // Drag state
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  // Resize state
  const resizeRef = useRef<{ startX: number; startY: number; originW: number; originH: number } | null>(null);

  // ─── Drag ─────────────────────────────────────────────────────
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startY: e.clientY, originX: pos.x, originY: pos.y };

    const handleMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = ev.clientX - dragRef.current.startX;
      const dy = ev.clientY - dragRef.current.startY;
      setPos({
        x: Math.max(0, Math.min(window.innerWidth - 100, dragRef.current.originX + dx)),
        y: Math.max(0, Math.min(window.innerHeight - 40, dragRef.current.originY + dy)),
      });
    };
    const handleUp = () => {
      dragRef.current = null;
      document.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseup", handleUp);
    };
    document.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseup", handleUp);
  }, [pos]);

  // ─── Resize ───────────────────────────────────────────────────
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizeRef.current = { startX: e.clientX, startY: e.clientY, originW: size.w, originH: size.h };

    const handleMove = (ev: MouseEvent) => {
      if (!resizeRef.current) return;
      const dx = ev.clientX - resizeRef.current.startX;
      const dy = ev.clientY - resizeRef.current.startY;
      setSize({
        w: Math.max(minWidth, resizeRef.current.originW + dx),
        h: Math.max(minHeight, resizeRef.current.originH + dy),
      });
    };
    const handleUp = () => {
      resizeRef.current = null;
      document.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseup", handleUp);
    };
    document.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseup", handleUp);
  }, [size, minWidth, minHeight]);

  // Escape key to close
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed z-[9999] flex flex-col bg-[var(--bg-1)] border border-[var(--border)] rounded-lg shadow-2xl overflow-hidden"
      style={{
        left: pos.x,
        top: pos.y,
        width: size.w,
        height: size.h,
      }}
    >
      {/* Title bar — draggable */}
      <div
        className="flex items-center gap-2 px-3 py-2 bg-[var(--glass)] border-b border-[var(--border)] cursor-move select-none flex-shrink-0"
        onMouseDown={handleDragStart}
      >
        {icon}
        <span className="text-xs font-semibold text-[var(--text)] flex-1">{title}</span>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-[var(--glass-2)] text-[var(--text-muted)] hover:text-[var(--text)] cursor-pointer transition-colors"
          title="Dock back (Esc)"
        >
          <Minimize2 size={14} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        {children}
      </div>

      {/* Resize handle */}
      <div
        className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize"
        onMouseDown={handleResizeStart}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" className="text-[var(--text-muted)] opacity-40">
          <path d="M14 14L8 14L14 8Z" fill="currentColor" />
          <path d="M14 14L12 14L14 12Z" fill="currentColor" />
        </svg>
      </div>
    </div>,
    document.body,
  );
}

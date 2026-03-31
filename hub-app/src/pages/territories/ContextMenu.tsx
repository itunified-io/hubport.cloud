import { useEffect, useRef, useCallback } from "react";
import { Trash2 } from "lucide-react";
import { FormattedMessage } from "react-intl";

interface ContextMenuProps {
  /** Screen position for the menu */
  x: number;
  y: number;
  /** Vertex index to operate on */
  vertexIndex: number;
  /** Current number of vertices (excluding closing vertex) */
  vertexCount: number;
  /** Called to delete the vertex */
  onDelete: (index: number) => void;
  /** Called to close the menu */
  onClose: () => void;
}

/**
 * Right-click / long-press context menu for vertex operations.
 * Enforces minimum 3 vertices — delete is disabled when vertexCount <= 3.
 */
export function ContextMenu({
  x,
  y,
  vertexIndex,
  vertexCount,
  onDelete,
  onClose,
}: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const canDelete = vertexCount > 3;

  // Close on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    }

    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [onClose]);

  const handleDelete = useCallback(() => {
    if (canDelete) {
      onDelete(vertexIndex);
      onClose();
    }
  }, [canDelete, vertexIndex, onDelete, onClose]);

  return (
    <div
      ref={menuRef}
      className="fixed z-50 bg-[var(--bg-1)] border border-[var(--border-2)] rounded-[var(--radius-sm)] shadow-lg py-1 min-w-[160px]"
      style={{ left: x, top: y }}
    >
      <button
        onClick={handleDelete}
        disabled={!canDelete}
        className={`flex items-center gap-2 w-full px-3 py-2 text-sm text-left transition-colors cursor-pointer ${
          canDelete
            ? "text-[var(--red)] hover:bg-[var(--glass)]"
            : "text-[var(--text-muted)] opacity-50 cursor-not-allowed"
        }`}
      >
        <Trash2 size={14} />
        <FormattedMessage
          id="territories.deleteVertex"
          defaultMessage="Delete vertex"
        />
        {!canDelete && (
          <span className="text-xs text-[var(--text-muted)] ml-auto">
            <FormattedMessage
              id="territories.minVertices"
              defaultMessage="(min 3)"
            />
          </span>
        )}
      </button>
    </div>
  );
}

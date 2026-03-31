import { FormattedMessage } from "react-intl";
import {
  Undo2,
  Redo2,
  Save,
  AlertCircle,
  Crosshair,
  Hexagon,
} from "lucide-react";
import type { EditorMode } from "../../hooks/useTerritoryEditor";

interface EditHUDProps {
  canUndo: boolean;
  canRedo: boolean;
  saving: boolean;
  saveError: string | null;
  vertexCount: number;
  snapTargetCount: number;
  mode: EditorMode;
}

/**
 * Bottom bar overlay showing editor status:
 * - Undo/redo keyboard hints
 * - Save status indicator
 * - Vertex count
 * - Snap target count
 */
export function EditHUD({
  canUndo,
  canRedo,
  saving,
  saveError,
  vertexCount,
  snapTargetCount,
  mode,
}: EditHUDProps) {
  const isMac =
    typeof navigator !== "undefined" &&
    navigator.platform?.includes("Mac");
  const ctrlKey = isMac ? "\u2318" : "Ctrl";

  return (
    <div className="absolute bottom-3 left-3 right-3 z-40 flex items-center justify-between bg-[var(--bg-1)]/90 backdrop-blur-sm border border-[var(--border)] rounded-[var(--radius-sm)] px-4 py-2">
      {/* Left: Undo/Redo hints */}
      <div className="flex items-center gap-4 text-xs text-[var(--text-muted)]">
        <span
          className={`flex items-center gap-1 ${canUndo ? "text-[var(--text)]" : "opacity-40"}`}
        >
          <Undo2 size={12} />
          {ctrlKey}+Z
        </span>
        <span
          className={`flex items-center gap-1 ${canRedo ? "text-[var(--text)]" : "opacity-40"}`}
        >
          <Redo2 size={12} />
          {ctrlKey}+Shift+Z
        </span>
        <span className="text-[var(--text-muted)] opacity-60">|</span>
        <span className="opacity-60">Alt = no snap</span>
      </div>

      {/* Center: Mode label */}
      <div className="text-xs font-medium text-[var(--amber)]">
        {mode === "edit" ? (
          <FormattedMessage
            id="territories.editMode"
            defaultMessage="EDIT MODE"
          />
        ) : mode === "create" ? (
          <FormattedMessage
            id="territories.createMode"
            defaultMessage="CREATE MODE"
          />
        ) : null}
      </div>

      {/* Right: Stats & Save status */}
      <div className="flex items-center gap-4 text-xs text-[var(--text-muted)]">
        <span className="flex items-center gap-1">
          <Hexagon size={12} />
          {vertexCount}
        </span>
        <span className="flex items-center gap-1">
          <Crosshair size={12} />
          {snapTargetCount}
        </span>

        {saving && (
          <span className="flex items-center gap-1 text-[var(--amber)]">
            <Save size={12} className="animate-pulse" />
            <FormattedMessage
              id="territories.saving"
              defaultMessage="Saving..."
            />
          </span>
        )}

        {saveError && (
          <span className="flex items-center gap-1 text-[var(--red)]">
            <AlertCircle size={12} />
            {saveError}
          </span>
        )}
      </div>
    </div>
  );
}

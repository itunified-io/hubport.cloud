/**
 * ConflictDialog — modal that presents a sync conflict to the user and lets
 * them choose between keeping their local version or accepting the server's.
 *
 * Props:
 *  - conflict    PendingChange record (table, recordId, operation)
 *  - onResolved  callback invoked after resolution (reloads conflict list)
 */
import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { resolveKeepMine, resolveUseTheirs } from "@/lib/sync-engine";
import type { PendingChange } from "@/lib/offline-db";

interface ConflictDialogProps {
  conflict: PendingChange;
  onResolved: () => void;
}

export function ConflictDialog({ conflict, onResolved }: ConflictDialogProps) {
  const [busy, setBusy] = useState(false);

  async function handleUseTheirs() {
    if (busy || conflict.id == null) return;
    setBusy(true);
    try {
      await resolveUseTheirs(conflict.id);
      onResolved();
    } finally {
      setBusy(false);
    }
  }

  async function handleKeepMine() {
    if (busy || conflict.id == null) return;
    setBusy(true);
    try {
      await resolveKeepMine(conflict.id);
      onResolved();
    } finally {
      setBusy(false);
    }
  }

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      role="dialog"
      aria-modal="true"
      aria-labelledby="conflict-dialog-title"
    >
      {/* Panel */}
      <div className="w-full max-w-md mx-4 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-1)] shadow-xl">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-[var(--border)]">
          <AlertTriangle size={18} className="text-[var(--amber)] shrink-0" />
          <h2
            id="conflict-dialog-title"
            className="text-sm font-semibold text-[var(--text)]"
          >
            Sync Conflict
          </h2>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-3">
          <p className="text-sm text-[var(--text-muted)]">
            A conflict was detected between your local changes and the server version.
            Choose which version to keep.
          </p>

          {/* Conflict details */}
          <div className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-2)] px-4 py-3 space-y-1 text-xs text-[var(--text-muted)]">
            <div>
              <span className="text-[var(--text)]">Table:</span>{" "}
              <span className="font-mono">{conflict.table}</span>
            </div>
            <div>
              <span className="text-[var(--text)]">Record:</span>{" "}
              <span className="font-mono">{conflict.recordId}</span>
            </div>
            <div>
              <span className="text-[var(--text)]">Operation:</span>{" "}
              <span className="font-mono">{conflict.operation}</span>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-[var(--border)]">
          {/* Use server version — neutral/secondary style */}
          <button
            onClick={handleUseTheirs}
            disabled={busy}
            className="px-4 py-2 rounded-[var(--radius-sm)] text-sm text-[var(--text-muted)] bg-[var(--glass)] hover:text-[var(--text)] hover:bg-[var(--glass-2)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            Use Theirs
          </button>

          {/* Keep local version — amber accent */}
          <button
            onClick={handleKeepMine}
            disabled={busy}
            className="px-4 py-2 rounded-[var(--radius-sm)] text-sm font-semibold bg-[var(--amber)] text-black hover:bg-[var(--amber-light)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            Keep Mine
          </button>
        </div>
      </div>
    </div>
  );
}

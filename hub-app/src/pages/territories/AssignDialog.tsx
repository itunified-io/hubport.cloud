import { useState, useEffect } from "react";
import { X, Search, Calendar, User } from "lucide-react";
import { useAuth } from "@/auth/useAuth";
import { getApiUrl } from "@/lib/config";
import type { BoardPublisher } from "./PublisherSidebar";

interface AssignDialogProps {
  territoryId: string;
  territoryNumber: string;
  publishers: BoardPublisher[];
  /** Pre-selected publisher (e.g. from drag-and-drop) */
  preSelectedPublisherId?: string;
  onConfirm: (publisherId: string, dueDate: string, notes: string) => void;
  onClose: () => void;
}

interface SuggestedDue {
  suggestedDue: string;
  addressCount: number;
  avgAddressCount: number;
  defaultCheckoutDays: number;
}

export function AssignDialog({
  territoryId,
  territoryNumber,
  publishers,
  preSelectedPublisherId,
  onConfirm,
  onClose,
}: AssignDialogProps) {
  const { user } = useAuth();
  const [publisherId, setPublisherId] = useState(preSelectedPublisherId ?? "");
  const [search, setSearch] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [suggestedDue, setSuggestedDue] = useState<SuggestedDue | null>(null);
  const [loadingSuggestion, setLoadingSuggestion] = useState(true);

  useEffect(() => {
    const fetchSuggestion = async () => {
      try {
        const apiUrl = getApiUrl();
        const res = await fetch(`${apiUrl}/territories/${territoryId}/suggested-due`, {
          headers: { Authorization: `Bearer ${user?.access_token}` },
        });
        if (res.ok) {
          const data = (await res.json()) as SuggestedDue;
          setSuggestedDue(data);
          setDueDate(data.suggestedDue.split("T")[0] ?? "");
        }
      } catch {
        // Use fallback date (4 months from now)
        const fallback = new Date();
        fallback.setMonth(fallback.getMonth() + 4);
        setDueDate(fallback.toISOString().split("T")[0] ?? "");
      } finally {
        setLoadingSuggestion(false);
      }
    };
    fetchSuggestion();
  }, [territoryId, user?.access_token]);

  const filtered = publishers.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase()),
  );

  const canSubmit = publisherId && dueDate;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative bg-[var(--bg-1)] border border-[var(--border)] rounded-[var(--radius)] w-full max-w-md p-6 space-y-5 shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-[var(--text)]">
            Assign Territory #{territoryNumber}
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-[var(--glass)] transition-colors cursor-pointer"
          >
            <X size={18} className="text-[var(--text-muted)]" />
          </button>
        </div>

        {/* Publisher picker */}
        <div className="space-y-2">
          <label className="text-xs font-medium text-[var(--text-muted)]">Publisher / Group</label>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search publishers..."
              className="w-full pl-8 pr-3 py-2 text-sm bg-[var(--bg-2)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--amber)]"
            />
          </div>
          <div className="max-h-40 overflow-y-auto space-y-1 border border-[var(--border)] rounded-[var(--radius-sm)] p-1">
            {filtered.map((p) => (
              <button
                key={p.id}
                onClick={() => setPublisherId(p.id)}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded text-sm text-left transition-colors cursor-pointer ${
                  publisherId === p.id
                    ? "bg-[var(--glass-2)] text-[var(--amber)]"
                    : "text-[var(--text)] hover:bg-[var(--glass)]"
                }`}
              >
                <User size={14} className={publisherId === p.id ? "text-[var(--amber)]" : "text-[var(--text-muted)]"} />
                <span className="truncate">{p.name}</span>
                <span className="ml-auto text-[10px] text-[var(--text-muted)]">
                  {p.activeAssignments} active
                </span>
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="text-xs text-[var(--text-muted)] text-center py-3">No publishers found</p>
            )}
          </div>
        </div>

        {/* Due date */}
        <div className="space-y-2">
          <label className="text-xs font-medium text-[var(--text-muted)]">Due Date</label>
          {loadingSuggestion ? (
            <div className="h-9 bg-[var(--glass-2)] rounded-[var(--radius-sm)] animate-pulse" />
          ) : (
            <>
              <div className="relative">
                <Calendar size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="w-full pl-8 pr-3 py-2 text-sm bg-[var(--bg-2)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text)] focus:outline-none focus:border-[var(--amber)]"
                />
              </div>
              {suggestedDue && (
                <p className="text-[10px] text-[var(--text-muted)]">
                  Suggested based on {suggestedDue.addressCount} addresses
                  (avg {suggestedDue.avgAddressCount}, default {suggestedDue.defaultCheckoutDays} days)
                </p>
              )}
            </>
          )}
        </div>

        {/* Notes */}
        <div className="space-y-2">
          <label className="text-xs font-medium text-[var(--text-muted)]">Notes (optional)</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Any notes for this assignment..."
            className="w-full px-3 py-2 text-sm bg-[var(--bg-2)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--amber)] resize-none"
          />
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-[var(--text-muted)] border border-[var(--border)] rounded-[var(--radius-sm)] hover:bg-[var(--glass)] transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={() => canSubmit && onConfirm(publisherId, dueDate, notes)}
            disabled={!canSubmit}
            className="px-4 py-2 text-sm font-semibold bg-[var(--amber)] text-black rounded-[var(--radius-sm)] hover:bg-[var(--amber-light)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            Assign
          </button>
        </div>
      </div>
    </div>
  );
}

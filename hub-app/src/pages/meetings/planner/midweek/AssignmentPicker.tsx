// hub-app/src/pages/meetings/planner/midweek/AssignmentPicker.tsx
import { useState, useEffect } from "react";
import type { Publisher } from "./types";

interface AssignmentPickerProps {
  title: string;
  assignmentId: string;
  slotKey: string;
  meetingType: string;
  apiUrl: string;
  headers: Record<string, string>;
  onAssign: (assignmentId: string, publisherId: string) => void;
  onClose: () => void;
}

export function AssignmentPicker({
  title, assignmentId, slotKey, meetingType, apiUrl, headers, onAssign, onClose,
}: AssignmentPickerProps) {
  const [eligible, setEligible] = useState<Publisher[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const res = await fetch(
        `${apiUrl}/meeting-assignments/eligible?slotKey=${slotKey}&meetingType=${meetingType}`,
        { headers },
      );
      if (res.ok) setEligible(await res.json());
      setLoading(false);
    })();
  }, [apiUrl, headers, slotKey, meetingType]);

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-[var(--bg-1)] rounded-[var(--radius)] p-4 w-full max-w-sm border border-[var(--border)] max-h-96 overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-semibold text-[var(--text)] mb-3 text-sm">{title}</h3>
        {loading ? (
          <p className="text-sm text-[var(--text-muted)]">Loading...</p>
        ) : eligible.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">No eligible publishers</p>
        ) : (
          <div className="space-y-0.5">
            {eligible.map((pub) => (
              <button
                key={pub.id}
                onClick={() => onAssign(assignmentId, pub.id)}
                className="w-full text-left px-3 py-2 rounded text-sm hover:bg-[var(--bg-2)] text-[var(--text)] cursor-pointer"
              >
                {pub.displayName || `${pub.firstName} ${pub.lastName}`}
              </button>
            ))}
          </div>
        )}
        <button
          onClick={onClose}
          className="mt-3 w-full px-3 py-1.5 border border-[var(--border)] rounded text-sm text-[var(--text-muted)] hover:bg-[var(--bg-2)] cursor-pointer"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

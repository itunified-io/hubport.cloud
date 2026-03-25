// hub-app/src/pages/meetings/planner/midweek/DutySidebar.tsx
import { Headphones, Shield, Sparkles, Send, Printer } from "lucide-react";
import { DUTY_COLORS } from "./constants";
import type { Assignment } from "./types";

interface DutySidebarProps {
  assignments: Assignment[];
  assignedCount: number;
  openCount: number;
  status: string;
  locked: boolean;
  onEditAssignment: (assignmentId: string, slotKey: string, title: string) => void;
  onPublish: () => void;
  onPrint: () => void;
}

const DUTY_GROUPS: { key: string; label: string; color: keyof typeof DUTY_COLORS; Icon: typeof Headphones; slots: string[] }[] = [
  {
    key: "technik", label: "Technik", color: "technik", Icon: Headphones,
    slots: ["sound", "video_pc", "microphone_1", "microphone_2", "stage", "zoom"],
  },
  {
    key: "ordnung", label: "Ordnungsdienst", color: "ordnung", Icon: Shield,
    slots: ["attendant_1", "attendant_2"],
  },
  {
    key: "reinigung", label: "Reinigung", color: "reinigung", Icon: Sparkles,
    slots: ["deep_cleaning", "spot_cleaning"],
  },
];

const SLOT_LABELS: Record<string, string> = {
  sound: "Sound", video_pc: "Video / PC", microphone_1: "Mikrofon 1", microphone_2: "Mikrofon 2",
  stage: "Bühne", zoom: "Zoom", attendant_1: "Saaldiener 1", attendant_2: "Saaldiener 2",
  deep_cleaning: "Grundreinigung", spot_cleaning: "Sichtreinigung",
};

export function DutySidebar({
  assignments, assignedCount, openCount, status, locked, onEditAssignment, onPublish, onPrint,
}: DutySidebarProps) {
  const dutyMap = new Map(assignments.map((a) => [a.slotTemplate.slotKey, a]));

  return (
    <div className="flex flex-col gap-2.5">
      {/* Duty groups */}
      {DUTY_GROUPS.map((group) => {
        const colors = DUTY_COLORS[group.color];
        return (
          <div key={group.key} className="rounded-[var(--radius)] overflow-hidden border border-[var(--border)] bg-[var(--bg-1)] shadow-[0_1px_3px_rgba(0,0,0,0.3)]">
            <div className={`px-3 py-[5px] flex items-center gap-1.5 ${colors.header}`}>
              <group.Icon size={11} className="text-white/70" />
              <span className="text-[10px] font-bold uppercase tracking-wide text-white/90">{group.label}</span>
            </div>
            {group.slots.map((slotKey, i) => {
              const a = dutyMap.get(slotKey);
              const name = a?.assignee
                ? (a.assignee.displayName || `${a.assignee.firstName[0]}. ${a.assignee.lastName}`)
                : null;
              return (
                <div key={slotKey} className={`flex items-center justify-between px-3 py-[5px] ${i > 0 ? "border-t border-white/[0.03]" : ""}`}>
                  <span className="text-[11px] text-[var(--text-muted)]">{SLOT_LABELS[slotKey] ?? slotKey}</span>
                  <div className="flex items-center gap-1">
                    <span className={`text-[11px] font-medium ${name ? "" : "text-zinc-600 italic"}`}>
                      {name ?? "—"}
                    </span>
                    {!locked && a && (
                      <button
                        onClick={() => onEditAssignment(a.id, slotKey, SLOT_LABELS[slotKey] ?? slotKey)}
                        className={`text-[8px] px-[5px] py-px border border-[var(--border)] rounded-[3px] bg-transparent cursor-pointer ${name ? "text-zinc-600" : "text-[var(--amber)]"}`}
                      >
                        {name ? "✎" : "+"}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}

      {/* Stats */}
      <div className="grid grid-cols-2 gap-1.5">
        <div className="bg-[var(--bg-1)] border border-[var(--border)] rounded-[var(--radius-sm)] p-2 text-center">
          <div className="text-[9px] text-[var(--text-muted)]">Zugewiesen</div>
          <div className="text-lg font-bold text-[var(--green)]">{assignedCount}</div>
        </div>
        <div className="bg-[var(--bg-1)] border border-[var(--border)] rounded-[var(--radius-sm)] p-2 text-center">
          <div className="text-[9px] text-[var(--text-muted)]">Offen</div>
          <div className="text-lg font-bold text-[var(--amber)]">{openCount}</div>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex gap-1.5">
        <button
          onClick={onPublish}
          disabled={locked || status === "published"}
          className="flex-1 py-[7px] text-[11px] font-semibold bg-[var(--green)] text-black border-none rounded-[var(--radius-sm)] cursor-pointer flex items-center justify-center gap-[5px] disabled:opacity-50"
        >
          <Send size={14} />
          Veröffentlichen
        </button>
        <button
          onClick={onPrint}
          className="py-[7px] px-3 text-[11px] border border-[var(--border)] bg-transparent text-[var(--text-muted)] rounded-[var(--radius-sm)] cursor-pointer flex items-center justify-center gap-[5px]"
        >
          <Printer size={14} />
          Drucken
        </button>
      </div>
    </div>
  );
}

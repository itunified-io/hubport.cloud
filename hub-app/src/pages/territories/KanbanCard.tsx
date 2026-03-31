import { type CSSProperties } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { User, Calendar, ArrowRight, Clock, RotateCcw } from "lucide-react";

export interface BoardTerritory {
  id: string;
  number: string;
  name: string | null;
  addressCount: number;
  assignment?: {
    id: string;
    publisherId: string;
    dueDate: string | null;
    assignedAt: string;
    publisher?: { id: string; firstName: string; lastName: string; displayName: string | null };
    workedAddresses?: number;
  };
  returnedAt?: string;
  publisher?: { id: string; firstName: string; lastName: string; displayName: string | null };
}

interface KanbanCardProps {
  territory: BoardTerritory;
  column: "available" | "assigned" | "dueSoon" | "overdue" | "returned";
  onAssign?: (territoryId: string) => void;
  onExtend?: (territoryId: string) => void;
  onReturn?: (territoryId: string) => void;
}

function daysUntilDue(dueDate: string | null | undefined): number | null {
  if (!dueDate) return null;
  const due = new Date(dueDate);
  const now = new Date();
  return Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

function dueDateColor(days: number | null): string {
  if (days === null) return "text-[var(--text-muted)]";
  if (days < 0) return "text-[var(--red)]";
  if (days <= 14) return "text-amber-400";
  return "text-[var(--text-muted)]";
}

function publisherName(pub: { firstName: string; lastName: string; displayName: string | null } | undefined): string {
  if (!pub) return "";
  return pub.displayName ?? `${pub.firstName} ${pub.lastName}`;
}

export function KanbanCard({ territory, column, onAssign, onExtend, onReturn }: KanbanCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: territory.id, data: { territory, column } });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const pub = territory.assignment?.publisher ?? territory.publisher;
  const days = daysUntilDue(territory.assignment?.dueDate);
  const worked = territory.assignment?.workedAddresses ?? 0;
  const total = territory.addressCount;
  const progress = total > 0 ? Math.round((worked / total) * 100) : 0;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="bg-[var(--bg-2)] border border-[var(--border)] rounded-[var(--radius-sm)] p-3 space-y-2 cursor-grab active:cursor-grabbing hover:border-[var(--border-2)] transition-colors"
    >
      {/* Header: number + name */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-[var(--text)]">
          #{territory.number}
        </span>
        {territory.name && (
          <span className="text-xs text-[var(--text-muted)] truncate ml-2">
            {territory.name}
          </span>
        )}
      </div>

      {/* Publisher */}
      {pub && (
        <div className="flex items-center gap-1.5">
          <User size={12} className="text-[var(--text-muted)]" />
          <span className="text-xs text-[var(--text-muted)] truncate">
            {publisherName(pub)}
          </span>
        </div>
      )}

      {/* Due date */}
      {territory.assignment?.dueDate && (
        <div className={`flex items-center gap-1.5 ${dueDateColor(days)}`}>
          <Calendar size={12} />
          <span className="text-xs">
            {new Date(territory.assignment.dueDate).toLocaleDateString()}
            {days !== null && (
              <span className="ml-1">
                ({days < 0 ? `${Math.abs(days)}d overdue` : `${days}d left`})
              </span>
            )}
          </span>
        </div>
      )}

      {/* Returned date */}
      {column === "returned" && territory.returnedAt && (
        <div className="flex items-center gap-1.5 text-[var(--green)]">
          <RotateCcw size={12} />
          <span className="text-xs">
            Returned {new Date(territory.returnedAt).toLocaleDateString()}
          </span>
        </div>
      )}

      {/* Progress bar */}
      {total > 0 && column !== "available" && column !== "returned" && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[10px] text-[var(--text-muted)]">
            <span>{worked}/{total} addresses</span>
            <span>{progress}%</span>
          </div>
          <div className="h-1 bg-[var(--glass-2)] rounded-full overflow-hidden">
            <div
              className="h-full bg-[var(--amber)] rounded-full transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {/* Quick actions */}
      <div className="flex items-center gap-1 pt-1">
        {column === "available" && onAssign && (
          <button
            onClick={(e) => { e.stopPropagation(); onAssign(territory.id); }}
            className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-[var(--blue)] bg-[#3b82f614] rounded hover:bg-[#3b82f628] transition-colors cursor-pointer"
          >
            <ArrowRight size={10} /> Assign
          </button>
        )}
        {(column === "assigned" || column === "dueSoon" || column === "overdue") && (
          <>
            {onExtend && (
              <button
                onClick={(e) => { e.stopPropagation(); onExtend(territory.id); }}
                className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-[var(--amber)] bg-[#d9770614] rounded hover:bg-[#d9770628] transition-colors cursor-pointer"
              >
                <Clock size={10} /> Extend
              </button>
            )}
            {onReturn && (
              <button
                onClick={(e) => { e.stopPropagation(); onReturn(territory.id); }}
                className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-[var(--green)] bg-[#22c55e14] rounded hover:bg-[#22c55e28] transition-colors cursor-pointer"
              >
                <RotateCcw size={10} /> Return
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

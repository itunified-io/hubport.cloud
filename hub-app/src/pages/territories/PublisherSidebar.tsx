import { useDraggable } from "@dnd-kit/core";
import { User, Users } from "lucide-react";

export interface BoardPublisher {
  id: string;
  name: string;
  activeAssignments: number;
}

interface PublisherSidebarProps {
  publishers: BoardPublisher[];
  loading: boolean;
}

function capacityColor(count: number): string {
  if (count === 0) return "text-[var(--green)]";
  if (count <= 2) return "text-[var(--amber)]";
  return "text-[var(--red)]";
}

function capacityBar(count: number): string {
  // Max capacity assumed 5 territories
  const pct = Math.min((count / 5) * 100, 100);
  return `${pct}%`;
}

function DraggablePublisher({ publisher }: { publisher: BoardPublisher }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `publisher-${publisher.id}`,
    data: { type: "publisher", publisher },
  });

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={`flex items-center gap-3 px-3 py-2 rounded-[var(--radius-sm)] border border-[var(--border)] hover:border-[var(--border-2)] cursor-grab active:cursor-grabbing transition-all ${
        isDragging ? "opacity-50" : ""
      }`}
    >
      <div className="w-7 h-7 rounded-full bg-[var(--glass-2)] flex items-center justify-center flex-shrink-0">
        <User size={14} className="text-[var(--text-muted)]" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-[var(--text)] truncate">
          {publisher.name}
        </p>
        <div className="flex items-center gap-2 mt-0.5">
          <span className={`text-[10px] font-medium ${capacityColor(publisher.activeAssignments)}`}>
            {publisher.activeAssignments} territories
          </span>
          <div className="flex-1 h-1 bg-[var(--glass-2)] rounded-full overflow-hidden">
            <div
              className="h-full bg-[var(--amber)] rounded-full transition-all"
              style={{ width: capacityBar(publisher.activeAssignments) }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export function PublisherSidebar({ publishers, loading }: PublisherSidebarProps) {
  if (loading) {
    return (
      <div className="w-64 border-l border-[var(--border)] bg-[var(--bg-1)] p-4">
        <div className="animate-pulse space-y-3">
          <div className="h-5 bg-[var(--glass-2)] rounded w-24" />
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-12 bg-[var(--glass-2)] rounded" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="w-64 border-l border-[var(--border)] bg-[var(--bg-1)] flex flex-col">
      <div className="p-3 border-b border-[var(--border)]">
        <div className="flex items-center gap-2">
          <Users size={16} className="text-[var(--text-muted)]" />
          <h3 className="text-sm font-semibold text-[var(--text)]">Publishers</h3>
          <span className="ml-auto text-xs text-[var(--text-muted)]">
            {publishers.length}
          </span>
        </div>
        <p className="text-[10px] text-[var(--text-muted)] mt-1">
          Drag a publisher onto a territory card to assign
        </p>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {publishers.map((pub) => (
          <DraggablePublisher key={pub.id} publisher={pub} />
        ))}
        {publishers.length === 0 && (
          <p className="text-xs text-[var(--text-muted)] text-center py-4">
            No active publishers
          </p>
        )}
      </div>
    </div>
  );
}

import { useState, useEffect, useCallback } from "react";
import {
  DndContext,
  DragOverlay,
  type DragStartEvent,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { Search, Filter, Kanban } from "lucide-react";
import { useAuth } from "@/auth/useAuth";
import { getApiUrl } from "@/lib/config";
import { KanbanCard, type BoardTerritory } from "./KanbanCard";
import { PublisherSidebar, type BoardPublisher } from "./PublisherSidebar";
import { AssignDialog } from "./AssignDialog";

type ColumnId = "available" | "assigned" | "dueSoon" | "overdue" | "returned";

interface BoardData {
  available: BoardTerritory[];
  assigned: BoardTerritory[];
  overdue: BoardTerritory[];
  recentlyReturned: BoardTerritory[];
}

const COLUMN_CONFIG: { id: ColumnId; label: string; color: string; bgClass: string }[] = [
  { id: "available", label: "Available", color: "var(--text-muted)", bgClass: "border-[var(--text-muted)]" },
  { id: "assigned", label: "Assigned", color: "var(--blue)", bgClass: "border-[var(--blue)]" },
  { id: "dueSoon", label: "Due Soon", color: "#f59e0b", bgClass: "border-amber-400" },
  { id: "overdue", label: "Overdue", color: "var(--red)", bgClass: "border-[var(--red)]" },
  { id: "returned", label: "Returned", color: "var(--green)", bgClass: "border-[var(--green)]" },
];

function splitDueSoon(assigned: BoardTerritory[]): { assigned: BoardTerritory[]; dueSoon: BoardTerritory[] } {
  const now = new Date();
  const threshold = new Date();
  threshold.setDate(now.getDate() + 14);

  const regular: BoardTerritory[] = [];
  const soon: BoardTerritory[] = [];

  for (const t of assigned) {
    const due = t.assignment?.dueDate ? new Date(t.assignment.dueDate) : null;
    if (due && due <= threshold && due > now) {
      soon.push(t);
    } else {
      regular.push(t);
    }
  }

  return { assigned: regular, dueSoon: soon };
}

export function KanbanBoard() {
  const { user } = useAuth();
  const apiUrl = getApiUrl();
  const headers = { Authorization: `Bearer ${user?.access_token}`, "Content-Type": "application/json" };

  const [columns, setColumns] = useState<Record<ColumnId, BoardTerritory[]>>({
    available: [],
    assigned: [],
    dueSoon: [],
    overdue: [],
    returned: [],
  });
  const [publishers, setPublishers] = useState<BoardPublisher[]>([]);
  const [loading, setLoading] = useState(true);
  const [pubLoading, setPubLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [activeCard, setActiveCard] = useState<BoardTerritory | null>(null);

  // Assign dialog state
  const [assignTarget, setAssignTarget] = useState<{ territoryId: string; number: string; prePublisherId?: string } | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const fetchBoard = useCallback(async () => {
    try {
      const res = await fetch(`${apiUrl}/territories/board`, { headers });
      if (res.ok) {
        const data = (await res.json()) as BoardData;
        const { assigned, dueSoon } = splitDueSoon(data.assigned);
        setColumns({
          available: data.available,
          assigned,
          dueSoon,
          overdue: data.overdue,
          returned: data.recentlyReturned,
        });
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [apiUrl, user?.access_token]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchPublishers = useCallback(async () => {
    try {
      const res = await fetch(`${apiUrl}/territories/board/publishers`, { headers });
      if (res.ok) {
        setPublishers((await res.json()) as BoardPublisher[]);
      }
    } catch {
      // silently fail
    } finally {
      setPubLoading(false);
    }
  }, [apiUrl, user?.access_token]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchBoard();
    fetchPublishers();
  }, [fetchBoard, fetchPublishers]);

  const handleDragStart = (event: DragStartEvent) => {
    const data = event.active.data.current;
    if (data?.territory) {
      setActiveCard(data.territory as BoardTerritory);
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveCard(null);

    const { active, over } = event;
    if (!over) return;

    const activeData = active.data.current;
    const overData = over.data.current;

    // Publisher dragged onto a territory card
    if (activeData?.type === "publisher" && overData?.territory) {
      const territory = overData.territory as BoardTerritory;
      const publisher = activeData.publisher as BoardPublisher;
      setAssignTarget({
        territoryId: territory.id,
        number: territory.number,
        prePublisherId: publisher.id,
      });
      return;
    }

    // Territory card moved (potential column change triggers actions)
    if (activeData?.territory && overData?.territory) {
      const from = activeData.column as ColumnId;
      const to = overData.column as ColumnId;
      const territory = activeData.territory as BoardTerritory;

      if (from !== to) {
        if (to === "available" && from !== "available") {
          // Return territory
          handleReturn(territory.id);
        } else if (from === "available" && to !== "available") {
          // Assign territory
          setAssignTarget({ territoryId: territory.id, number: territory.number });
        }
      }
    }
  };

  const handleAssign = (territoryId: string) => {
    const territory = columns.available.find((t) => t.id === territoryId);
    if (territory) {
      setAssignTarget({ territoryId, number: territory.number });
    }
  };

  const handleReturn = async (territoryId: string) => {
    try {
      await fetch(`${apiUrl}/territories/${territoryId}/return`, {
        method: "POST",
        headers,
      });
      await fetchBoard();
      await fetchPublishers();
    } catch {
      // silently fail
    }
  };

  const handleExtend = async (territoryId: string) => {
    try {
      await fetch(`${apiUrl}/territories/${territoryId}/extend`, {
        method: "POST",
        headers,
        body: JSON.stringify({ days: 30 }),
      });
      await fetchBoard();
    } catch {
      // silently fail
    }
  };

  const confirmAssign = async (publisherId: string, dueDate: string, notes: string) => {
    if (!assignTarget) return;
    try {
      await fetch(`${apiUrl}/territories/${assignTarget.territoryId}/assign`, {
        method: "POST",
        headers,
        body: JSON.stringify({ publisherId, dueDate, notes }),
      });
      setAssignTarget(null);
      await fetchBoard();
      await fetchPublishers();
    } catch {
      // silently fail
    }
  };

  // Filter territories across all columns
  const filterTerritories = (territories: BoardTerritory[]): BoardTerritory[] => {
    return territories.filter((t) => {
      if (search) {
        const q = search.toLowerCase();
        const matchesNumber = t.number.toLowerCase().includes(q);
        const matchesName = t.name?.toLowerCase().includes(q);
        if (!matchesNumber && !matchesName) return false;
      }
      // typeFilter can be used for campaign filtering in future
      if (typeFilter !== "all") return true;
      return true;
    });
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Kanban size={20} className="text-[var(--amber)]" />
          <h1 className="text-xl font-semibold text-[var(--text)]">Territory Board</h1>
        </div>
        <div className="flex gap-4">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex-1 space-y-3">
              <div className="h-6 bg-[var(--glass-2)] rounded w-20 animate-pulse" />
              {[1, 2, 3].map((j) => (
                <div key={j} className="h-24 bg-[var(--glass-2)] rounded animate-pulse" />
              ))}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Kanban size={20} className="text-[var(--amber)]" />
          <h1 className="text-xl font-semibold text-[var(--text)]">Territory Board</h1>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by number or name..."
            className="w-full pl-8 pr-3 py-2 text-sm bg-[var(--bg-1)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--amber)]"
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter size={14} className="text-[var(--text-muted)]" />
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="text-sm bg-[var(--bg-1)] border border-[var(--border)] rounded-[var(--radius-sm)] px-3 py-2 text-[var(--text)] focus:outline-none focus:border-[var(--amber)]"
          >
            <option value="all">All Types</option>
            <option value="urban">Urban</option>
            <option value="rural">Rural</option>
            <option value="business">Business</option>
          </select>
        </div>
      </div>

      {/* Board + Sidebar */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="flex gap-0 min-h-[calc(100vh-220px)]">
          {/* Columns */}
          <div className="flex-1 flex gap-3 overflow-x-auto pb-4">
            {COLUMN_CONFIG.map((col) => {
              const items = filterTerritories(columns[col.id]);
              return (
                <div key={col.id} className="flex-1 min-w-[200px] flex flex-col">
                  {/* Column header */}
                  <div className={`flex items-center gap-2 pb-2 mb-2 border-b-2 ${col.bgClass}`}>
                    <span className="text-sm font-semibold text-[var(--text)]">{col.label}</span>
                    <span className="text-xs text-[var(--text-muted)] bg-[var(--glass-2)] px-1.5 py-0.5 rounded-full">
                      {items.length}
                    </span>
                  </div>

                  {/* Cards */}
                  <SortableContext items={items.map((t) => t.id)} strategy={verticalListSortingStrategy}>
                    <div className="space-y-2 flex-1">
                      {items.map((t) => (
                        <KanbanCard
                          key={t.id}
                          territory={t}
                          column={col.id}
                          onAssign={col.id === "available" ? handleAssign : undefined}
                          onExtend={col.id !== "available" && col.id !== "returned" ? handleExtend : undefined}
                          onReturn={col.id !== "available" && col.id !== "returned" ? handleReturn : undefined}
                        />
                      ))}
                      {items.length === 0 && (
                        <div className="py-8 text-center">
                          <p className="text-xs text-[var(--text-muted)]">No territories</p>
                        </div>
                      )}
                    </div>
                  </SortableContext>
                </div>
              );
            })}
          </div>

          {/* Publisher sidebar */}
          <PublisherSidebar publishers={publishers} loading={pubLoading} />
        </div>

        <DragOverlay>
          {activeCard && (
            <div className="w-[200px]">
              <KanbanCard territory={activeCard} column="available" />
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {/* Assign dialog */}
      {assignTarget && (
        <AssignDialog
          territoryId={assignTarget.territoryId}
          territoryNumber={assignTarget.number}
          publishers={publishers}
          preSelectedPublisherId={assignTarget.prePublisherId}
          onConfirm={confirmAssign}
          onClose={() => setAssignTarget(null)}
        />
      )}
    </div>
  );
}

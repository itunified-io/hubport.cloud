import { useCallback, useEffect, useState } from "react";
import { FormattedMessage } from "react-intl";
import { Edit3, Plus, Scissors, Save, X } from "lucide-react";
import { useUndoRedo } from "../../hooks/useUndoRedo";
import {
  useTerritoryEditor,
  type EditorMode,
  type Territory,
} from "../../hooks/useTerritoryEditor";
import { useSnapEngine } from "../../hooks/useSnapEngine";
import { VertexHandle } from "./VertexHandle";
import { MidpointHandle } from "./MidpointHandle";
import { ContextMenu } from "./ContextMenu";
import { EditHUD } from "./EditHUD";
import { CreationFlow } from "./CreationFlow";
import { SplitFlow } from "./SplitFlow";
import { extractVertices } from "../../lib/geometry-utils";

interface TerritoryEditorProps {
  /** All territories for snap targets (neighbor boundaries) */
  territories: Territory[];
  /** Congregation boundary geometry (if any) */
  congregationBoundary?: object | null;
}

interface ContextMenuState {
  x: number;
  y: number;
  vertexIndex: number;
}

/**
 * Main territory editor component.
 * Wraps map with editing controls, vertex handles, and mode management.
 */
export function TerritoryEditor({
  territories,
  congregationBoundary = null,
}: TerritoryEditorProps) {
  const editor = useTerritoryEditor();
  const undoRedo = useUndoRedo();
  const [altPressed, setAltPressed] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  // Track polygon coordinates for the selected territory in edit mode
  const [editCoords, setEditCoords] = useState<[number, number][]>([]);

  // Get neighbor geometries for snap engine
  const neighborGeometries = territories
    .filter(
      (t) =>
        t.id !== editor.selectedTerritory?.id && t.boundaries,
    )
    .map((t) => t.boundaries!)
    .filter(Boolean);

  const snapEngine = useSnapEngine(
    editor.snapContext?.features ?? null,
    neighborGeometries,
    congregationBoundary,
  );

  // Track Alt/Option key
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Alt") setAltPressed(true);
      // Ctrl+Z / Cmd+Z for undo
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        undoRedo.undo();
      }
      // Ctrl+Shift+Z / Cmd+Shift+Z for redo
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && e.shiftKey) {
        e.preventDefault();
        undoRedo.redo();
      }
      // Escape to exit edit mode
      if (e.key === "Escape") {
        editor.setMode("view");
        setContextMenu(null);
      }
    }

    function onKeyUp(e: KeyboardEvent) {
      if (e.key === "Alt") setAltPressed(false);
    }

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [undoRedo, editor]);

  // Initialize edit coordinates when entering edit mode
  useEffect(() => {
    if (
      editor.mode === "edit" &&
      editor.selectedTerritory?.boundaries
    ) {
      const vertices = extractVertices(editor.selectedTerritory.boundaries);
      setEditCoords(vertices);
    }
  }, [editor.mode, editor.selectedTerritory]);

  const handleVertexMove = useCallback(
    (index: number, position: [number, number]) => {
      setEditCoords((prev) => {
        const next = [...prev];
        next[index] = position;
        // If moving the first vertex, also update the closing vertex
        if (index === 0 && next.length > 1) {
          next[next.length - 1] = [position[0], position[1]];
        }
        // If moving the last vertex, also update the first
        if (index === next.length - 1 && next.length > 1) {
          next[0] = [position[0], position[1]];
        }
        return next;
      });
    },
    [],
  );

  const handleVertexDragEnd = useCallback(
    (
      index: number,
      before: [number, number],
      after: [number, number],
    ) => {
      if (editor.selectedTerritory) {
        undoRedo.push({
          territoryId: editor.selectedTerritory.id,
          beforeGeometry: { type: "vertex_move", index, position: before },
          afterGeometry: { type: "vertex_move", index, position: after },
          description: `Move vertex ${index}`,
        });
      }
    },
    [editor.selectedTerritory, undoRedo],
  );

  const handleMidpointInsert = useCallback(
    (edgeIndex: number, position: [number, number]) => {
      setEditCoords((prev) => {
        const next = [...prev];
        // Insert after edgeIndex
        next.splice(edgeIndex + 1, 0, position);
        return next;
      });

      if (editor.selectedTerritory) {
        undoRedo.push({
          territoryId: editor.selectedTerritory.id,
          beforeGeometry: null,
          afterGeometry: {
            type: "vertex_insert",
            index: edgeIndex + 1,
            position,
          },
          description: `Insert vertex at edge ${edgeIndex}`,
        });
      }
    },
    [editor.selectedTerritory, undoRedo],
  );

  const handleVertexDelete = useCallback(
    (index: number) => {
      const deleted = editCoords[index];
      setEditCoords((prev) => {
        const next = prev.filter((_, i) => i !== index);
        // Ensure ring closure
        if (next.length >= 2) {
          const first = next[0]!;
          next[next.length - 1] = [first[0], first[1]];
        }
        return next;
      });

      if (editor.selectedTerritory && deleted) {
        undoRedo.push({
          territoryId: editor.selectedTerritory.id,
          beforeGeometry: {
            type: "vertex_delete",
            index,
            position: deleted,
          },
          afterGeometry: null,
          description: `Delete vertex ${index}`,
        });
      }
    },
    [editCoords, editor.selectedTerritory, undoRedo],
  );

  const handleContextMenu = useCallback(
    (index: number, event: React.MouseEvent) => {
      setContextMenu({
        x: event.clientX,
        y: event.clientY,
        vertexIndex: index,
      });
    },
    [],
  );

  const handleSave = useCallback(async () => {
    if (!editor.selectedTerritory || editCoords.length < 4) return;

    const geometry = {
      type: "Polygon" as const,
      coordinates: [editCoords],
    };

    try {
      await editor.saveBoundaries(editor.selectedTerritory.id, geometry);
      editor.setMode("view");
    } catch {
      // Error is already captured in editor.saveError
    }
  }, [editor, editCoords]);

  const handleSetMode = useCallback(
    (newMode: EditorMode) => {
      editor.setMode(newMode);
      setContextMenu(null);
      if (newMode === "view") {
        undoRedo.clear();
      }
    },
    [editor, undoRedo],
  );

  // Calculate midpoints for edges
  const midpoints: Array<{
    edgeIndex: number;
    position: [number, number];
  }> = [];
  if (editor.mode === "edit" && editCoords.length >= 3) {
    // Exclude the closing vertex for midpoint calculation
    const vertexCount = editCoords.length - 1;
    for (let i = 0; i < vertexCount; i++) {
      const a = editCoords[i]!;
      const b = editCoords[(i + 1) % vertexCount]!;
      midpoints.push({
        edgeIndex: i,
        position: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
      });
    }
  }

  // Unique vertex count (excluding closing vertex)
  const uniqueVertexCount =
    editCoords.length > 0 ? editCoords.length - 1 : 0;

  return (
    <div className="relative h-full">
      {/* Mode toolbar */}
      <div className="absolute top-3 right-3 z-10 flex gap-2">
        {editor.mode === "view" && editor.selectedTerritory && (
          <>
            <button
              onClick={() => handleSetMode("edit")}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-[var(--bg-1)] border border-[var(--border-2)] text-[var(--text)] rounded-[var(--radius-sm)] hover:bg-[var(--glass)] transition-colors cursor-pointer"
            >
              <Edit3 size={14} />
              <FormattedMessage
                id="territories.edit"
                defaultMessage="Edit"
              />
            </button>
            <button
              onClick={() => handleSetMode("split")}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-[var(--bg-1)] border border-[var(--border-2)] text-[var(--text)] rounded-[var(--radius-sm)] hover:bg-[var(--glass)] transition-colors cursor-pointer"
            >
              <Scissors size={14} />
              <FormattedMessage
                id="territories.split"
                defaultMessage="Split"
              />
            </button>
          </>
        )}

        {editor.mode === "view" && !editor.selectedTerritory && (
          <button
            onClick={() => handleSetMode("create")}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-[var(--amber)] text-black font-medium rounded-[var(--radius-sm)] hover:bg-[var(--amber-light)] transition-colors cursor-pointer"
          >
            <Plus size={14} />
            <FormattedMessage
              id="territories.create"
              defaultMessage="New Territory"
            />
          </button>
        )}

        {(editor.mode === "edit" || editor.mode === "create") && (
          <>
            <button
              onClick={handleSave}
              disabled={editor.saving}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-[var(--green)] text-black font-medium rounded-[var(--radius-sm)] hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50"
            >
              <Save size={14} />
              <FormattedMessage
                id="territories.save"
                defaultMessage="Save"
              />
            </button>
            <button
              onClick={() => handleSetMode("view")}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-[var(--bg-1)] border border-[var(--border-2)] text-[var(--text-muted)] rounded-[var(--radius-sm)] hover:bg-[var(--glass)] transition-colors cursor-pointer"
            >
              <X size={14} />
              <FormattedMessage
                id="territories.cancel"
                defaultMessage="Cancel"
              />
            </button>
          </>
        )}
      </div>

      {/* Vertex handles in edit mode */}
      {editor.mode === "edit" && editCoords.length > 0 && (
        <svg
          className="absolute inset-0 w-full h-full pointer-events-none z-20"
          style={{ overflow: "visible" }}
        >
          <g className="pointer-events-auto">
            {/* Vertex handles (skip closing vertex) */}
            {editCoords.slice(0, -1).map((coord, idx) => (
              <VertexHandle
                key={`v-${idx}`}
                index={idx}
                position={coord}
                snapTargets={[]}
                snapTolerance={0.0001}
                altPressed={altPressed}
                onMove={handleVertexMove}
                onDragEnd={handleVertexDragEnd}
                onContextMenu={handleContextMenu}
              />
            ))}

            {/* Midpoint handles */}
            {midpoints.map((mp) => (
              <MidpointHandle
                key={`mp-${mp.edgeIndex}`}
                edgeIndex={mp.edgeIndex}
                position={mp.position}
                onInsert={handleMidpointInsert}
              />
            ))}
          </g>
        </svg>
      )}

      {/* Creation flow */}
      {editor.mode === "create" && (
        <CreationFlow
          onComplete={(coords) => {
            setEditCoords(coords);
            editor.setMode("edit");
          }}
          onCancel={() => handleSetMode("view")}
        />
      )}

      {/* Split flow */}
      {editor.mode === "split" && editor.selectedTerritory && (
        <SplitFlow
          territory={editor.selectedTerritory}
          onComplete={() => handleSetMode("view")}
          onCancel={() => handleSetMode("view")}
        />
      )}

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          vertexIndex={contextMenu.vertexIndex}
          vertexCount={uniqueVertexCount}
          onDelete={handleVertexDelete}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* Edit HUD */}
      {(editor.mode === "edit" || editor.mode === "create") && (
        <EditHUD
          canUndo={undoRedo.canUndo}
          canRedo={undoRedo.canRedo}
          saving={editor.saving}
          saveError={editor.saveError}
          vertexCount={uniqueVertexCount}
          snapTargetCount={snapEngine.targetCount}
          mode={editor.mode}
        />
      )}
    </div>
  );
}

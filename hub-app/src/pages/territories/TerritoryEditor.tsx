import { useCallback, useEffect, useState } from "react";
import { FormattedMessage } from "react-intl";
import { Edit3, Plus, Scissors, Crop, Save, X } from "lucide-react";
import { useUndoRedo } from "../../hooks/useUndoRedo";
import {
  useTerritoryEditor,
  type EditorMode,
  type Territory,
} from "../../hooks/useTerritoryEditor";
import { useSnapEngine } from "../../hooks/useSnapEngine";
import { snapAll, type SnapReport } from "./SnapEngine";
import { VertexHandle } from "./VertexHandle";
import { MidpointHandle } from "./MidpointHandle";
import { ContextMenu } from "./ContextMenu";
import { EditHUD } from "./EditHUD";
import { CreationFlow } from "./CreationFlow";
import { SplitFlow } from "./SplitFlow";
import { ClipSegmentPanel } from "./ClipSegmentPanel";
import { useClipSegment } from "../../hooks/useClipSegment";
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
  const [snapPreview, setSnapPreview] = useState<{
    original: [number, number][];
    snapped: [number, number][];
    report: SnapReport[];
  } | null>(null);

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

  // Clip segment tool
  const clipSegment = useClipSegment(editCoords, snapEngine.targets);

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
            <button
              onClick={() => {
                // Enter clip mode: load editCoords and activate clip segment selection
                if (editor.selectedTerritory?.boundaries) {
                  const vertices = extractVertices(editor.selectedTerritory.boundaries);
                  setEditCoords(vertices);
                }
                editor.setMode("clip");
                clipSegment.start();
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-[var(--bg-1)] border border-[var(--border-2)] text-[var(--text)] rounded-[var(--radius-sm)] hover:bg-[var(--glass)] transition-colors cursor-pointer"
            >
              <Crop size={14} />
              <FormattedMessage
                id="territories.clip"
                defaultMessage="Clip"
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

        {(editor.mode === "edit" || editor.mode === "create") && !snapPreview && (
          <>
            {editor.mode === "edit" && editCoords.length >= 4 && (
              <button
                onClick={() => {
                  const verts = editCoords.slice(0, -1); // exclude closing vertex
                  const result = snapAll(verts, snapEngine.targets, snapEngine.tolerance);
                  setSnapPreview({ original: verts, snapped: result.snapped, report: result.report });
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-blue-500/80 text-white font-medium rounded-[var(--radius-sm)] hover:bg-blue-400 transition-colors cursor-pointer"
                title="Snap all vertices to nearest roads"
              >
                Snap All
              </button>
            )}
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

        {editor.mode === "clip" && (
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
              onClick={() => {
                clipSegment.cancel();
                handleSetMode("view");
              }}
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

        {snapPreview && (
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-[var(--text-muted)] bg-[var(--bg-1)] px-2 py-1 rounded border border-[var(--border)]">
              {snapPreview.report.filter((r) => r.snappedTo !== null).length}/{snapPreview.report.length} snapped
            </span>
            <button
              onClick={() => {
                // Apply snapped coords (re-close ring)
                const closed = [...snapPreview.snapped, snapPreview.snapped[0]!];
                setEditCoords(closed);
                if (editor.selectedTerritory) {
                  undoRedo.push({
                    territoryId: editor.selectedTerritory.id,
                    beforeGeometry: { type: "snap_all", coords: snapPreview.original },
                    afterGeometry: { type: "snap_all", coords: snapPreview.snapped },
                    description: "Snap All",
                  });
                }
                setSnapPreview(null);
              }}
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold bg-green-500/90 text-white rounded-[var(--radius-sm)] hover:bg-green-400 transition-colors cursor-pointer"
            >
              Accept Snap
            </button>
            <button
              onClick={() => setSnapPreview(null)}
              className="px-3 py-1.5 text-xs text-[var(--text-muted)] border border-[var(--border)] rounded-[var(--radius-sm)] hover:bg-[var(--glass)] transition-colors cursor-pointer"
            >
              Revert
            </button>
          </div>
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

      {/* Clip mode: show clickable vertex handles */}
      {editor.mode === "clip" && editCoords.length > 0 && (
        <svg
          className="absolute inset-0 w-full h-full pointer-events-none z-20"
          style={{ overflow: "visible" }}
        >
          <g className="pointer-events-auto">
            {editCoords.slice(0, -1).map((coord, idx) => {
              const isStart = clipSegment.startIndex === idx;
              const isEnd = clipSegment.endIndex === idx;
              const isSelected = isStart || isEnd;
              // Highlight vertices in the selected segment
              const inSegment =
                clipSegment.startIndex !== null &&
                clipSegment.endIndex !== null &&
                (() => {
                  const s = clipSegment.startIndex!;
                  const e = clipSegment.endIndex!;
                  return s <= e
                    ? idx >= s && idx <= e
                    : idx >= s || idx <= e;
                })();

              return (
                <circle
                  key={`clip-v-${idx}`}
                  cx={coord[0]}
                  cy={coord[1]}
                  r={isSelected ? 8 : inSegment ? 6 : 5}
                  fill={
                    isStart
                      ? "var(--amber)"
                      : isEnd
                        ? "var(--green)"
                        : inSegment
                          ? "rgba(251, 191, 36, 0.5)"
                          : "rgba(255, 255, 255, 0.7)"
                  }
                  stroke={isSelected ? "white" : "var(--border-2)"}
                  strokeWidth={isSelected ? 2 : 1}
                  style={{ cursor: "pointer" }}
                  onClick={() => clipSegment.selectVertex(idx)}
                />
              );
            })}
          </g>
        </svg>
      )}

      {/* Clip segment panel (target selection) */}
      {editor.mode === "clip" &&
        clipSegment.phase === "choose_target" && (
          <ClipSegmentPanel
            candidates={clipSegment.candidates}
            onSelectCandidate={(candidate) => {
              const newCoords = clipSegment.applyClip(candidate);
              if (newCoords) {
                const beforeCoords = [...editCoords];
                setEditCoords(newCoords);
                if (editor.selectedTerritory) {
                  undoRedo.push({
                    territoryId: editor.selectedTerritory.id,
                    beforeGeometry: { type: "clip_segment", coords: beforeCoords },
                    afterGeometry: { type: "clip_segment", coords: newCoords },
                    description: `Clip to ${candidate.label}`,
                  });
                }
              }
            }}
            onStraighten={() => {
              const newCoords = clipSegment.straighten();
              if (newCoords) {
                const beforeCoords = [...editCoords];
                setEditCoords(newCoords);
                if (editor.selectedTerritory) {
                  undoRedo.push({
                    territoryId: editor.selectedTerritory.id,
                    beforeGeometry: { type: "clip_segment", coords: beforeCoords },
                    afterGeometry: { type: "clip_segment", coords: newCoords },
                    description: "Straighten segment",
                  });
                }
              }
            }}
            onCancel={clipSegment.cancel}
          />
      )}

      {/* Clip mode status HUD */}
      {editor.mode === "clip" && (
        <div className="absolute bottom-4 left-4 z-20 bg-[var(--bg-1)]/90 border border-[var(--border)] rounded-[var(--radius-sm)] px-3 py-2 text-[10px] text-[var(--text-muted)]">
          {clipSegment.phase === "idle" || clipSegment.phase === "select_start"
            ? "Click first vertex to start segment"
            : clipSegment.phase === "select_end"
              ? "Click second vertex to end segment"
              : "Choose a clip target"}
        </div>
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
      {(editor.mode === "edit" || editor.mode === "create" || editor.mode === "clip") && (
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

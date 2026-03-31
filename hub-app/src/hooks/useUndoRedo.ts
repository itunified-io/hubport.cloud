import { useCallback, useRef, useState } from "react";

export interface UndoEntry {
  territoryId: string;
  beforeGeometry: object | null;
  afterGeometry: object | null;
  description: string;
  timestamp: number;
  sequenceNumber: number;
}

const MAX_ENTRIES = 50;

export interface UseUndoRedoReturn {
  /** Push a new entry onto the undo stack */
  push: (entry: Omit<UndoEntry, "timestamp" | "sequenceNumber">) => void;
  /** Undo the last action. Returns the entry or null if nothing to undo. */
  undo: () => UndoEntry | null;
  /** Redo the last undone action. Returns the entry or null if nothing to redo. */
  redo: () => UndoEntry | null;
  /** Whether undo is available */
  canUndo: boolean;
  /** Whether redo is available */
  canRedo: boolean;
  /** Current undo stack size */
  undoCount: number;
  /** Current redo stack size */
  redoCount: number;
  /** Clear all history */
  clear: () => void;
}

/**
 * Hook for undo/redo with geometry state management.
 * Max 50 entries. Pushing a new entry clears the redo stack.
 */
export function useUndoRedo(): UseUndoRedoReturn {
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([]);
  const [redoStack, setRedoStack] = useState<UndoEntry[]>([]);
  const sequenceRef = useRef(0);

  const push = useCallback(
    (entry: Omit<UndoEntry, "timestamp" | "sequenceNumber">) => {
      sequenceRef.current += 1;
      const fullEntry: UndoEntry = {
        ...entry,
        timestamp: Date.now(),
        sequenceNumber: sequenceRef.current,
      };

      setUndoStack((prev) => {
        const next = [...prev, fullEntry];
        // Trim to max entries
        if (next.length > MAX_ENTRIES) {
          return next.slice(next.length - MAX_ENTRIES);
        }
        return next;
      });

      // Push clears the redo stack
      setRedoStack([]);
    },
    [],
  );

  const undo = useCallback((): UndoEntry | null => {
    let entry: UndoEntry | null = null;

    setUndoStack((prev) => {
      if (prev.length === 0) return prev;
      entry = prev[prev.length - 1]!;
      return prev.slice(0, -1);
    });

    if (entry) {
      setRedoStack((prev) => [...prev, entry!]);
    }

    return entry;
  }, []);

  const redo = useCallback((): UndoEntry | null => {
    let entry: UndoEntry | null = null;

    setRedoStack((prev) => {
      if (prev.length === 0) return prev;
      entry = prev[prev.length - 1]!;
      return prev.slice(0, -1);
    });

    if (entry) {
      setUndoStack((prev) => [...prev, entry!]);
    }

    return entry;
  }, []);

  const clear = useCallback(() => {
    setUndoStack([]);
    setRedoStack([]);
    sequenceRef.current = 0;
  }, []);

  return {
    push,
    undo,
    redo,
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
    undoCount: undoStack.length,
    redoCount: redoStack.length,
    clear,
  };
}

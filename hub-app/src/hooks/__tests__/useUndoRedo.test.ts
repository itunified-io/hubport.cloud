import { describe, it, expect } from "vitest";

/**
 * Test the undo/redo stack logic directly.
 * Since useUndoRedo is a React hook, we test the core stack behavior
 * via a plain class that mirrors the hook's logic.
 * The hook itself is a thin wrapper using useState around this logic.
 */

interface UndoEntry {
  territoryId: string;
  beforeGeometry: object | null;
  afterGeometry: object | null;
  description: string;
  timestamp: number;
  sequenceNumber: number;
}

const MAX_ENTRIES = 50;

/** Standalone stack implementation matching the hook's logic */
class UndoRedoStack {
  undoStack: UndoEntry[] = [];
  redoStack: UndoEntry[] = [];
  private seq = 0;

  push(entry: Omit<UndoEntry, "timestamp" | "sequenceNumber">) {
    this.seq++;
    const full: UndoEntry = {
      ...entry,
      timestamp: Date.now(),
      sequenceNumber: this.seq,
    };
    this.undoStack.push(full);
    if (this.undoStack.length > MAX_ENTRIES) {
      this.undoStack = this.undoStack.slice(this.undoStack.length - MAX_ENTRIES);
    }
    this.redoStack = [];
  }

  undo(): UndoEntry | null {
    if (this.undoStack.length === 0) return null;
    const entry = this.undoStack.pop()!;
    this.redoStack.push(entry);
    return entry;
  }

  redo(): UndoEntry | null {
    if (this.redoStack.length === 0) return null;
    const entry = this.redoStack.pop()!;
    this.undoStack.push(entry);
    return entry;
  }

  clear() {
    this.undoStack = [];
    this.redoStack = [];
    this.seq = 0;
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }
  get canRedo() {
    return this.redoStack.length > 0;
  }
}

describe("UndoRedo stack logic", () => {
  it("starts with empty stacks", () => {
    const stack = new UndoRedoStack();
    expect(stack.canUndo).toBe(false);
    expect(stack.canRedo).toBe(false);
    expect(stack.undoStack.length).toBe(0);
  });

  it("push adds entry to undo stack", () => {
    const stack = new UndoRedoStack();
    stack.push({
      territoryId: "t1",
      beforeGeometry: null,
      afterGeometry: { type: "Polygon", coordinates: [] },
      description: "Draw boundary",
    });
    expect(stack.canUndo).toBe(true);
    expect(stack.undoStack.length).toBe(1);
  });

  it("undo moves entry to redo stack", () => {
    const stack = new UndoRedoStack();
    stack.push({
      territoryId: "t1",
      beforeGeometry: null,
      afterGeometry: {},
      description: "Draw",
    });

    const entry = stack.undo();
    expect(entry).not.toBeNull();
    expect(stack.canUndo).toBe(false);
    expect(stack.canRedo).toBe(true);
    expect(stack.redoStack.length).toBe(1);
  });

  it("redo moves entry back to undo stack", () => {
    const stack = new UndoRedoStack();
    stack.push({
      territoryId: "t1",
      beforeGeometry: null,
      afterGeometry: {},
      description: "Draw",
    });
    stack.undo();
    stack.redo();

    expect(stack.canUndo).toBe(true);
    expect(stack.canRedo).toBe(false);
  });

  it("push clears redo stack", () => {
    const stack = new UndoRedoStack();
    stack.push({
      territoryId: "t1",
      beforeGeometry: null,
      afterGeometry: {},
      description: "First",
    });
    stack.undo();
    expect(stack.canRedo).toBe(true);

    stack.push({
      territoryId: "t1",
      beforeGeometry: null,
      afterGeometry: { v: 2 },
      description: "Second",
    });
    expect(stack.canRedo).toBe(false);
  });

  it("respects max 50 entries", () => {
    const stack = new UndoRedoStack();
    for (let i = 0; i < 60; i++) {
      stack.push({
        territoryId: "t1",
        beforeGeometry: null,
        afterGeometry: { idx: i },
        description: `Action ${i}`,
      });
    }
    expect(stack.undoStack.length).toBe(50);
  });

  it("undo returns null on empty stack", () => {
    const stack = new UndoRedoStack();
    expect(stack.undo()).toBeNull();
  });

  it("redo returns null on empty stack", () => {
    const stack = new UndoRedoStack();
    expect(stack.redo()).toBeNull();
  });

  it("clear resets both stacks", () => {
    const stack = new UndoRedoStack();
    stack.push({
      territoryId: "t1",
      beforeGeometry: null,
      afterGeometry: {},
      description: "Test",
    });
    stack.clear();
    expect(stack.canUndo).toBe(false);
    expect(stack.canRedo).toBe(false);
  });

  it("assigns sequential sequence numbers", () => {
    const stack = new UndoRedoStack();
    stack.push({
      territoryId: "t1",
      beforeGeometry: null,
      afterGeometry: {},
      description: "First",
    });
    stack.push({
      territoryId: "t1",
      beforeGeometry: {},
      afterGeometry: { v: 2 },
      description: "Second",
    });

    const second = stack.undo()!;
    const first = stack.undo()!;

    expect(second.sequenceNumber).toBeGreaterThan(first.sequenceNumber);
  });

  it("multiple undo/redo cycles work correctly", () => {
    const stack = new UndoRedoStack();
    stack.push({
      territoryId: "t1",
      beforeGeometry: null,
      afterGeometry: { v: 1 },
      description: "A",
    });
    stack.push({
      territoryId: "t1",
      beforeGeometry: { v: 1 },
      afterGeometry: { v: 2 },
      description: "B",
    });
    stack.push({
      territoryId: "t1",
      beforeGeometry: { v: 2 },
      afterGeometry: { v: 3 },
      description: "C",
    });

    // Undo twice
    stack.undo(); // removes C
    stack.undo(); // removes B
    expect(stack.undoStack.length).toBe(1);
    expect(stack.redoStack.length).toBe(2);

    // Redo once
    stack.redo(); // restores B
    expect(stack.undoStack.length).toBe(2);
    expect(stack.redoStack.length).toBe(1);

    // Push new entry — clears remaining redo
    stack.push({
      territoryId: "t1",
      beforeGeometry: { v: 2 },
      afterGeometry: { v: 4 },
      description: "D",
    });
    expect(stack.undoStack.length).toBe(3);
    expect(stack.redoStack.length).toBe(0);
  });
});

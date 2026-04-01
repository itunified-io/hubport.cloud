import { useCallback, useRef } from "react";

type SheetState = "collapsed" | "peek" | "expanded";

interface BottomSheetProps {
  state: SheetState;
  onStateChange: (state: SheetState) => void;
  collapsedContent?: React.ReactNode;
  peekContent?: React.ReactNode;
  expandedContent?: React.ReactNode;
}

const HEIGHTS: Record<SheetState, string> = {
  collapsed: "60px",
  peek: "180px",
  expanded: "60vh",
};

/**
 * Mobile bottom sheet with 3 states and drag gestures.
 */
export function BottomSheet({
  state,
  onStateChange,
  collapsedContent,
  peekContent,
  expandedContent,
}: BottomSheetProps) {
  const dragStartY = useRef<number | null>(null);
  const dragStartState = useRef<SheetState>(state);

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      const touch = e.touches[0];
      if (!touch) return;
      dragStartY.current = touch.clientY;
      dragStartState.current = state;
    },
    [state],
  );

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (dragStartY.current == null) return;
      const touch = e.changedTouches[0];
      if (!touch) return;
      const deltaY = dragStartY.current - touch.clientY;
      dragStartY.current = null;

      const threshold = 40;
      if (deltaY > threshold) {
        if (dragStartState.current === "collapsed") onStateChange("peek");
        else if (dragStartState.current === "peek") onStateChange("expanded");
      } else if (deltaY < -threshold) {
        if (dragStartState.current === "expanded") onStateChange("peek");
        else if (dragStartState.current === "peek") onStateChange("collapsed");
      }
    },
    [onStateChange],
  );

  return (
    <div
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        height: HEIGHTS[state],
        background: "var(--bg-surface, white)",
        borderTopLeftRadius: "16px",
        borderTopRightRadius: "16px",
        boxShadow: "0 -4px 20px rgba(0,0,0,0.15)",
        transition: "height 0.3s ease",
        zIndex: 1000,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* Drag handle */}
      <div style={{ display: "flex", justifyContent: "center", padding: "8px 0 4px", cursor: "grab" }}>
        <div style={{ width: "36px", height: "4px", borderRadius: "2px", background: "var(--border, #d1d5db)" }} />
      </div>

      {/* Collapsed bar */}
      <div style={{ padding: "0 16px", minHeight: "36px", flexShrink: 0 }}>
        {collapsedContent}
      </div>

      {/* Peek content */}
      {(state === "peek" || state === "expanded") && (
        <div style={{ padding: "8px 16px", flexShrink: 0 }}>
          {peekContent}
        </div>
      )}

      {/* Expanded content */}
      {state === "expanded" && (
        <div style={{ flex: 1, overflowY: "auto", padding: "0 16px 16px" }}>
          {expandedContent}
        </div>
      )}
    </div>
  );
}

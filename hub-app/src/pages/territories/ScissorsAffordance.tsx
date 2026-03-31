import { Scissors } from "lucide-react";

interface ScissorsAffordanceProps {
  /** Position [x, y] in screen coordinates */
  position: { x: number; y: number };
  /** Whether the scissors icon is visible */
  visible: boolean;
}

/**
 * Scissors icon rendered on territory edge hover during split mode.
 * Indicates where the user can start a split cut line.
 */
export function ScissorsAffordance({
  position,
  visible,
}: ScissorsAffordanceProps) {
  if (!visible) return null;

  return (
    <div
      className="absolute pointer-events-none z-30 transition-opacity duration-150"
      style={{
        left: position.x - 10,
        top: position.y - 10,
        opacity: visible ? 1 : 0,
      }}
    >
      <Scissors
        size={20}
        className="text-[var(--amber)] drop-shadow-md"
        style={{ transform: "rotate(90deg)" }}
      />
    </div>
  );
}

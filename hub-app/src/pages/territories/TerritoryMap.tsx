import { useRef } from "react";
import { FormattedMessage } from "react-intl";
import { useNavigate } from "react-router";
import { ArrowLeft, Map } from "lucide-react";
import { TerritoryEditor } from "./TerritoryEditor";
import { useMapLibre } from "../../hooks/useMapLibre";

export function TerritoryMap() {
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const { isLoaded } = useMapLibre({
    container: containerRef,
    center: [10.0, 48.0],
    zoom: 13,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate("/territories")}
          className="p-2 rounded-[var(--radius-sm)] text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--glass)] transition-colors cursor-pointer"
        >
          <ArrowLeft size={18} />
        </button>
        <h1 className="text-xl font-semibold text-[var(--text)]">
          <FormattedMessage id="territories.map" />
        </h1>
      </div>

      {/* Map container with editor overlay */}
      <div className="relative h-[70vh] border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)] overflow-hidden">
        <div ref={containerRef} className="absolute inset-0" />

        {/* Fallback when MapLibre is not loaded */}
        {!isLoaded && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-[var(--bg-1)]">
            <Map
              size={48}
              className="text-[var(--text-muted)] mb-4"
              strokeWidth={1}
            />
            <p className="text-sm text-[var(--text-muted)]">
              <FormattedMessage
                id="territories.mapLoading"
                defaultMessage="Loading map..."
              />
            </p>
            <p className="text-xs text-[var(--text-muted)] mt-1 opacity-60">
              <FormattedMessage
                id="territories.mapHint"
                defaultMessage="Territory boundaries and assignments will render here"
              />
            </p>
          </div>
        )}

        {/* Territory editor overlay */}
        <TerritoryEditor territories={[]} />
      </div>
    </div>
  );
}

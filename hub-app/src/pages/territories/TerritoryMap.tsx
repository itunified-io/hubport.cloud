import { FormattedMessage } from "react-intl";
import { useNavigate } from "react-router";
import { ArrowLeft, Map } from "lucide-react";

export function TerritoryMap() {
  const navigate = useNavigate();

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

      {/* Map placeholder */}
      <div className="flex flex-col items-center justify-center h-[60vh] border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)]">
        <Map size={48} className="text-[var(--text-muted)] mb-4" strokeWidth={1} />
        <p className="text-sm text-[var(--text-muted)]">
          MapLibre GL integration planned
        </p>
        <p className="text-xs text-[var(--text-muted)] mt-1 opacity-60">
          Territory boundaries and assignments will render here
        </p>
      </div>
    </div>
  );
}

import { FormattedMessage } from "react-intl";
import { useNavigate } from "react-router";
import { Map, MapPin } from "lucide-react";

export function TerritoryList() {
  const navigate = useNavigate();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-[var(--text)]">
          <FormattedMessage id="territories.title" />
        </h1>
        <button
          onClick={() => navigate("/territories/map")}
          className="flex items-center gap-2 px-4 py-2 border border-[var(--border-2)] text-[var(--text-muted)] text-sm font-medium rounded-[var(--radius-sm)] hover:bg-[var(--glass)] transition-colors cursor-pointer"
        >
          <MapPin size={16} />
          <FormattedMessage id="territories.map" />
        </button>
      </div>

      {/* Empty state */}
      <div className="flex flex-col items-center justify-center py-16 border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)]">
        <Map size={40} className="text-[var(--text-muted)] mb-3" strokeWidth={1.2} />
        <p className="text-sm text-[var(--text-muted)]">
          <FormattedMessage id="territories.empty" />
        </p>
      </div>
    </div>
  );
}

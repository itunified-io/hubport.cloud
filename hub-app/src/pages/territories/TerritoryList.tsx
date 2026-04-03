import { useEffect, useState, useCallback } from "react";
import { FormattedMessage } from "react-intl";
import { useNavigate } from "react-router";
import { Map, MapPin, Loader2, Search, Download } from "lucide-react";
import { useAuth } from "@/auth/useAuth";
import { usePermissions } from "@/auth/PermissionProvider";
import { listTerritories, type TerritoryListItem } from "@/lib/territory-api";
import ExportDropdown from "./ExportDropdown";

export function TerritoryList() {
  const { user } = useAuth();
  const { can } = usePermissions();
  const navigate = useNavigate();
  const token = user?.access_token ?? "";
  const canExport = can("app:territories.export");

  const [territories, setTerritories] = useState<TerritoryListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!token) return;
    // When user can export, fetch full data (with boundaries) for client-side export
    listTerritories(token, canExport ? {} : { lite: true })
      .then(setTerritories)
      .catch(() => setTerritories([]))
      .finally(() => setLoading(false));
  }, [token, canExport]);

  const filtered = territories.filter(
    (t) =>
      t.number.includes(search) ||
      t.name.toLowerCase().includes(search.toLowerCase()),
  );

  // Territories eligible for selection: has boundaries and is not congregation_boundary
  const selectable = filtered.filter(
    (t) => t.boundaries && t.type !== "congregation_boundary",
  );
  const allSelected = selectable.length > 0 && selectable.every((t) => selected.has(t.id));

  const toggleAll = useCallback(() => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(selectable.map((t) => t.id)));
    }
  }, [allSelected, selectable]);

  const toggleOne = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectedTerritories = territories.filter((t) => selected.has(t.id));

  const handleExportAll = useCallback(() => {
    // Select all exportable territories (with boundaries, not congregation_boundary)
    const exportable = territories.filter(
      (t) => t.boundaries && t.type !== "congregation_boundary",
    );
    setSelected(new Set(exportable.map((t) => t.id)));
  }, [territories]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-[var(--text)]">
          <FormattedMessage id="territories.title" />
        </h1>
        <div className="flex items-center gap-2">
          {canExport && selected.size > 0 && (
            <ExportDropdown territories={selectedTerritories} />
          )}
          <button
            onClick={() => navigate("/territories/map")}
            className="flex items-center gap-2 px-4 py-2 border border-[var(--border-2)] text-[var(--text-muted)] text-sm font-medium rounded-[var(--radius-sm)] hover:bg-[var(--glass)] transition-colors cursor-pointer"
          >
            <MapPin size={16} />
            <FormattedMessage id="territories.map" />
          </button>
        </div>
      </div>

      {/* Search + Export toolbar */}
      <div className="flex items-center justify-between gap-4">
        <div className="relative max-w-sm flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by number or name..."
            className="w-full pl-9 pr-3 py-2 text-sm bg-[var(--bg-1)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text)] placeholder:text-[var(--text-muted)]"
          />
        </div>

        {canExport && (
          <div className="flex items-center gap-2">
            {selected.size > 0 && (
              <span className="text-xs text-[var(--amber)] font-medium">
                <FormattedMessage
                  id="territory.export.selected"
                  values={{ count: selected.size }}
                />
              </span>
            )}
            <button
              onClick={handleExportAll}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-[var(--border)] text-[var(--text-muted)] rounded-[var(--radius-sm)] hover:bg-[var(--glass)] hover:text-[var(--text)] transition-colors cursor-pointer"
            >
              <Download size={13} />
              <FormattedMessage id="territory.export.all" />
            </button>
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={24} className="text-[var(--amber)] animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)]">
          <Map size={40} className="text-[var(--text-muted)] mb-3" strokeWidth={1.2} />
          <p className="text-sm text-[var(--text-muted)]">
            <FormattedMessage id="territories.empty" />
          </p>
        </div>
      ) : (
        <div className="border border-[var(--border)] rounded-[var(--radius)] overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[var(--bg-1)] border-b border-[var(--border)]">
                {canExport && (
                  <th className="px-3 py-3 w-10">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      className="accent-[var(--amber)] cursor-pointer"
                    />
                  </th>
                )}
                <th className="px-4 py-3 text-left font-medium text-[var(--text-muted)]">#</th>
                <th className="px-4 py-3 text-left font-medium text-[var(--text-muted)]">
                  <FormattedMessage id="common.name" defaultMessage="Name" />
                </th>
                <th className="px-4 py-3 text-left font-medium text-[var(--text-muted)]">
                  <FormattedMessage id="territories.assignedTo" defaultMessage="Assigned To" />
                </th>
                <th className="px-4 py-3 text-left font-medium text-[var(--text-muted)]">
                  <FormattedMessage id="territories.boundary" defaultMessage="Boundary" />
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {filtered.map((t) => {
                const activeAssignment = t.assignments.find((a) => !a.returnedAt);
                const hasBoundary = !!t.boundaries;
                const isCongBoundary = t.type === "congregation_boundary";
                const isSelectable = hasBoundary && !isCongBoundary;
                return (
                  <tr
                    key={t.id}
                    className={`hover:bg-[var(--glass)] transition-colors ${
                      selected.has(t.id) ? "bg-[var(--amber)]/5" : ""
                    }`}
                  >
                    {canExport && (
                      <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selected.has(t.id)}
                          disabled={!isSelectable}
                          onChange={() => toggleOne(t.id)}
                          className={`accent-[var(--amber)] ${
                            isSelectable ? "cursor-pointer" : "opacity-30 cursor-not-allowed"
                          }`}
                        />
                      </td>
                    )}
                    <td
                      className="px-4 py-3 text-[var(--amber)] font-mono font-semibold cursor-pointer"
                      onClick={() => navigate(`/territories/${t.id}`)}
                    >
                      {t.number}
                    </td>
                    <td
                      className="px-4 py-3 text-[var(--text)] cursor-pointer"
                      onClick={() => navigate(`/territories/${t.id}`)}
                    >
                      {t.name}
                    </td>
                    <td
                      className="px-4 py-3 text-[var(--text-muted)] cursor-pointer"
                      onClick={() => navigate(`/territories/${t.id}`)}
                    >
                      {activeAssignment
                        ? `${activeAssignment.publisher.firstName} ${activeAssignment.publisher.lastName}`
                        : "—"}
                    </td>
                    <td
                      className="px-4 py-3 cursor-pointer"
                      onClick={() => navigate(`/territories/${t.id}`)}
                    >
                      {hasBoundary ? (
                        <span className="inline-flex items-center gap-1 text-xs text-[var(--green)]">
                          <MapPin size={12} />
                          <FormattedMessage id="territories.hasBoundary" defaultMessage="Yes" />
                        </span>
                      ) : (
                        <span className="text-xs text-[var(--text-muted)]">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="px-4 py-2 bg-[var(--bg-1)] border-t border-[var(--border)] text-xs text-[var(--text-muted)]">
            {filtered.length} / {territories.length}
          </div>
        </div>
      )}
    </div>
  );
}

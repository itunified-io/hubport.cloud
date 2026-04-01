import { useEffect, useState } from "react";
import { FormattedMessage } from "react-intl";
import { useNavigate } from "react-router";
import { Map, MapPin, Loader2, Search } from "lucide-react";
import { useAuth } from "@/auth/useAuth";
import { listTerritories, type TerritoryListItem } from "@/lib/territory-api";

export function TerritoryList() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const token = user?.access_token ?? "";

  const [territories, setTerritories] = useState<TerritoryListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!token) return;
    listTerritories(token, { lite: true })
      .then(setTerritories)
      .catch(() => setTerritories([]))
      .finally(() => setLoading(false));
  }, [token]);

  const filtered = territories.filter(
    (t) =>
      t.number.includes(search) ||
      t.name.toLowerCase().includes(search.toLowerCase()),
  );

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

      {/* Search */}
      <div className="relative max-w-sm">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by number or name..."
          className="w-full pl-9 pr-3 py-2 text-sm bg-[var(--bg-1)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text)] placeholder:text-[var(--text-muted)]"
        />
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
                return (
                  <tr
                    key={t.id}
                    onClick={() => navigate(`/territories/${t.id}`)}
                    className="hover:bg-[var(--glass)] cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3 text-[var(--amber)] font-mono font-semibold">
                      {t.number}
                    </td>
                    <td className="px-4 py-3 text-[var(--text)]">{t.name}</td>
                    <td className="px-4 py-3 text-[var(--text-muted)]">
                      {activeAssignment
                        ? `${activeAssignment.publisher.firstName} ${activeAssignment.publisher.lastName}`
                        : "—"}
                    </td>
                    <td className="px-4 py-3">
                      {t.boundaries ? (
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

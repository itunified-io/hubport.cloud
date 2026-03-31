/**
 * Sidebar panel showing address list for a selected territory.
 * Sortable, filterable by status, with DNC auto-revert toast.
 */
import { useState, useEffect, useCallback } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import {
  MapPin, Plus, Search, Filter, Archive, Ban, ChevronRight,
  ArrowUpDown, Home, Building, Trees, SortAsc, SortDesc,
} from "lucide-react";
import { useAuth } from "@/auth/useAuth";
import {
  listAddresses,
  type Address,
  type AddressStatus,
  type AddressListResponse,
} from "@/lib/territory-api";

// ─── Status icons & colors ──────────────────────────────────────

const STATUS_META: Record<string, { icon: React.ElementType; color: string; dimmed?: boolean }> = {
  active: { icon: Home, color: "text-[var(--green)]" },
  do_not_call: { icon: Ban, color: "text-[var(--red)]", dimmed: true },
  not_at_home: { icon: Home, color: "text-[var(--amber)]" },
  moved: { icon: ArrowUpDown, color: "text-[var(--text-muted)]" },
  deceased: { icon: Home, color: "text-[var(--text-muted)]", dimmed: true },
  foreign_language: { icon: Home, color: "text-[var(--blue)]" },
  archived: { icon: Archive, color: "text-[var(--text-muted)]", dimmed: true },
};

const TYPE_ICONS: Record<string, React.ElementType> = {
  residential: Home,
  business: Building,
  apartment_building: Building,
  rural: Trees,
};

type SortField = "streetAddress" | "status" | "lastVisitDate" | "sortOrder";
type SortDir = "asc" | "desc";

interface AddressPanelProps {
  territoryId: string;
  onSelect?: (address: Address) => void;
  onAdd?: () => void;
  selectedAddressId?: string | null;
}

export function AddressPanel({
  territoryId,
  onSelect,
  onAdd,
  selectedAddressId,
}: AddressPanelProps) {
  const { user } = useAuth();
  const intl = useIntl();
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<AddressStatus | "all">("all");
  const [showArchived, setShowArchived] = useState(false);
  const [sortField, setSortField] = useState<SortField>("sortOrder");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [revertToast, setRevertToast] = useState<number | null>(null);

  const token = user?.access_token ?? "";

  const fetchAddresses = useCallback(async () => {
    if (!token || !territoryId) return;
    setLoading(true);
    try {
      const res: AddressListResponse = await listAddresses(territoryId, token, {
        showArchived: showArchived || undefined,
      });
      setAddresses(res.addresses);
      if (res.meta.revertedCount > 0) {
        setRevertToast(res.meta.revertedCount);
        setTimeout(() => setRevertToast(null), 5000);
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [token, territoryId, showArchived]);

  useEffect(() => {
    void fetchAddresses();
  }, [fetchAddresses]);

  // ─── Filter & sort ────────────────────────────────────────────

  const filtered = addresses
    .filter((a) => {
      if (statusFilter !== "all" && a.status !== statusFilter) return false;
      if (!showArchived && a.status === "archived") return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          a.streetAddress.toLowerCase().includes(q) ||
          (a.apartment?.toLowerCase().includes(q) ?? false) ||
          (a.city?.toLowerCase().includes(q) ?? false)
        );
      }
      return true;
    })
    .sort((a, b) => {
      let cmp = 0;
      if (sortField === "streetAddress") {
        cmp = a.streetAddress.localeCompare(b.streetAddress);
      } else if (sortField === "status") {
        cmp = a.status.localeCompare(b.status);
      } else if (sortField === "lastVisitDate") {
        const da = a.lastVisitDate ? new Date(a.lastVisitDate).getTime() : 0;
        const db = b.lastVisitDate ? new Date(b.lastVisitDate).getTime() : 0;
        cmp = da - db;
      } else {
        cmp = a.sortOrder - b.sortOrder;
      }
      return sortDir === "desc" ? -cmp : cmp;
    });

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  };

  const SortIcon = sortDir === "asc" ? SortAsc : SortDesc;

  // ─── Render ───────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full bg-[var(--bg-1)] border-l border-[var(--border)]">
      {/* Header */}
      <div className="p-4 border-b border-[var(--border)] space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[var(--text)]">
            <FormattedMessage
              id="territories.addresses"
              defaultMessage="Addresses"
            />
            <span className="ml-2 text-[var(--text-muted)] font-normal">
              ({filtered.length})
            </span>
          </h2>
          {onAdd && (
            <button
              onClick={onAdd}
              className="p-1.5 rounded-[var(--radius-sm)] text-[var(--amber)] hover:bg-[var(--glass)] transition-colors cursor-pointer"
              title={intl.formatMessage({ id: "territories.addAddress", defaultMessage: "Add address" })}
            >
              <Plus size={16} />
            </button>
          )}
        </div>

        {/* Search */}
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={intl.formatMessage({ id: "common.search", defaultMessage: "Search..." })}
            className="w-full pl-8 pr-3 py-1.5 text-sm bg-[var(--bg)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--amber)]"
          />
        </div>

        {/* Filters row */}
        <div className="flex items-center gap-2 text-xs">
          <Filter size={12} className="text-[var(--text-muted)]" />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as AddressStatus | "all")}
            className="bg-[var(--bg)] border border-[var(--border)] rounded-[var(--radius-sm)] px-2 py-1 text-[var(--text)] text-xs cursor-pointer"
          >
            <option value="all">
              {intl.formatMessage({ id: "common.all", defaultMessage: "All" })}
            </option>
            <option value="active">Active</option>
            <option value="do_not_call">Do Not Call</option>
            <option value="not_at_home">Not at Home</option>
            <option value="moved">Moved</option>
            <option value="foreign_language">Foreign Language</option>
          </select>

          <label className="flex items-center gap-1 ml-auto cursor-pointer text-[var(--text-muted)]">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
              className="accent-[var(--amber)]"
            />
            <Archive size={12} />
            <FormattedMessage id="territories.showArchived" defaultMessage="Archived" />
          </label>
        </div>

        {/* Sort buttons */}
        <div className="flex items-center gap-1 text-xs">
          {(
            [
              ["sortOrder", "#"],
              ["streetAddress", "Street"],
              ["status", "Status"],
              ["lastVisitDate", "Last Visit"],
            ] as [SortField, string][]
          ).map(([field, label]) => (
            <button
              key={field}
              onClick={() => toggleSort(field)}
              className={`px-2 py-0.5 rounded-[var(--radius-sm)] transition-colors cursor-pointer ${
                sortField === field
                  ? "bg-[var(--glass-2)] text-[var(--text)]"
                  : "text-[var(--text-muted)] hover:bg-[var(--glass)]"
              }`}
            >
              {label}
              {sortField === field && <SortIcon size={10} className="inline ml-0.5" />}
            </button>
          ))}
        </div>
      </div>

      {/* DNC auto-revert toast */}
      {revertToast !== null && (
        <div className="mx-4 mt-2 px-3 py-2 rounded-[var(--radius-sm)] bg-[#22c55e14] border border-[var(--green)] text-xs text-[var(--green)]">
          <FormattedMessage
            id="territories.dncReverted"
            defaultMessage="{count} {count, plural, one {address} other {addresses}} returned to active — do-not-visit period expired"
            values={{ count: revertToast }}
          />
        </div>
      )}

      {/* Address list */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--glass-2)] border-t-[var(--amber)]" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-[var(--text-muted)]">
            <MapPin size={28} strokeWidth={1.2} className="mb-2" />
            <p className="text-xs">
              <FormattedMessage
                id="territories.noAddresses"
                defaultMessage="No addresses found"
              />
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {filtered.map((addr) => {
              const meta = STATUS_META[addr.status] ?? STATUS_META.active!;
              const StatusIcon = meta.icon;
              const TypeIcon = TYPE_ICONS[addr.type] ?? Home;
              const isSelected = addr.addressId === selectedAddressId;

              return (
                <li key={addr.addressId}>
                  <button
                    onClick={() => onSelect?.(addr)}
                    className={`w-full text-left px-4 py-3 flex items-start gap-3 transition-colors cursor-pointer ${
                      isSelected
                        ? "bg-[var(--glass-2)]"
                        : "hover:bg-[var(--glass)]"
                    } ${meta.dimmed ? "opacity-60" : ""}`}
                  >
                    {/* Status icon */}
                    <div className={`mt-0.5 ${meta.color}`}>
                      <StatusIcon size={16} />
                    </div>

                    {/* Address info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-medium text-[var(--text)] truncate">
                          {addr.streetAddress}
                        </span>
                        {addr.apartment && (
                          <span className="text-xs text-[var(--text-muted)]">
                            {addr.apartment}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2 mt-0.5">
                        {addr.city && (
                          <span className="text-xs text-[var(--text-muted)]">
                            {addr.postalCode} {addr.city}
                          </span>
                        )}
                        {addr.languageSpoken && (
                          <span className="text-[10px] px-1.5 py-0 rounded-full bg-[var(--glass)] text-[var(--blue)]">
                            {addr.languageSpoken}
                          </span>
                        )}
                      </div>

                      {/* DNC info */}
                      {addr.status === "do_not_call" && addr.doNotCallReason && (
                        <div className="mt-1 text-[10px] text-[var(--red)]">
                          <Ban size={9} className="inline mr-0.5" />
                          {addr.doNotCallReason}
                          {addr.doNotVisitUntil && (
                            <span className="ml-1 text-[var(--text-muted)]">
                              until {new Date(addr.doNotVisitUntil).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                      )}

                      {/* Last visit */}
                      {addr.lastVisitDate && (
                        <div className="mt-0.5 text-[10px] text-[var(--text-muted)]">
                          Last: {new Date(addr.lastVisitDate).toLocaleDateString()}
                          {addr.lastVisitOutcome && (
                            <span className="ml-1">({addr.lastVisitOutcome.replace("_", " ")})</span>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Type icon + chevron */}
                    <div className="flex items-center gap-1 text-[var(--text-muted)]">
                      <TypeIcon size={12} />
                      <ChevronRight size={14} />
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

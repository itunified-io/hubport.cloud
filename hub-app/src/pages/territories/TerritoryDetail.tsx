import { useEffect, useState, useRef, useCallback } from "react";
import { FormattedMessage, FormattedDate, useIntl } from "react-intl";
import { useNavigate, useParams } from "react-router";
import {
  ArrowLeft, User, Calendar, Loader2, MapPin, Clock, Hash,
  Layers, Maximize2, Minimize2, Home, Building, Trees,
  Ban, ArrowUpDown, Archive, Search, Filter, Bell,
  ChevronDown, Check, X, Edit3,
} from "lucide-react";
import { useAuth } from "@/auth/useAuth";
import { usePermissions } from "@/auth/PermissionProvider";
import {
  getTerritory, listAddresses, updateAddress,
  previewFix, updateTerritoryBoundaries,
  type TerritoryListItem, type Address, type AddressStatus, type AutoFixResult,
} from "@/lib/territory-api";
import { CreationFlow } from "./CreationFlow";
import { AutoFixPreview } from "./AutoFixPreview";
import { VersionHistory } from "./VersionHistory";
import { useMapLibre, MAP_STYLES, type MapStyleKey } from "@/hooks/useMapLibre";
import { useGpsTracker } from "@/hooks/useGpsTracker";
import { MyLocationMarker, MY_LOCATION_MARKER_CSS } from "@/components/map/MyLocationMarker";

// ─── Status & type visuals ──────────────────────────────────────

const STATUS_META: Record<string, { icon: React.ElementType; color: string; label: string; dimmed?: boolean }> = {
  active:           { icon: Home,       color: "text-[var(--green)]",       label: "Active" },
  do_not_call:      { icon: Ban,        color: "text-[var(--red)]",         label: "Do Not Call",       dimmed: true },
  not_at_home:      { icon: Home,       color: "text-[var(--amber)]",       label: "Not at Home" },
  moved:            { icon: ArrowUpDown, color: "text-[var(--text-muted)]", label: "Moved" },
  deceased:         { icon: Home,       color: "text-[var(--text-muted)]",  label: "Deceased",          dimmed: true },
  foreign_language: { icon: Home,       color: "text-[var(--blue)]",        label: "Foreign Language" },
  archived:         { icon: Archive,    color: "text-[var(--text-muted)]",  label: "Archived",          dimmed: true },
};

const TYPE_ICONS: Record<string, React.ElementType> = {
  residential: Home,
  business: Building,
  apartment_building: Building,
  rural: Trees,
};

const STATUS_OPTIONS: { value: AddressStatus; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "not_at_home", label: "Not at Home" },
  { value: "do_not_call", label: "Do Not Call" },
  { value: "moved", label: "Moved" },
  { value: "foreign_language", label: "Foreign Language" },
  { value: "archived", label: "Archived" },
];

type TabId = "addresses" | "history";

export function TerritoryDetail() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const intl = useIntl();
  const token = user?.access_token ?? "";

  const [territory, setTerritory] = useState<TerritoryListItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mapExpanded, setMapExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>("addresses");
  const { can } = usePermissions();

  // Edit / creation state
  const [editMode, setEditMode] = useState(false);
  const [creationMode, setCreationMode] = useState(false);
  const [autoFixResult, setAutoFixResult] = useState<AutoFixResult | null>(null);
  const [pendingBoundaries, setPendingBoundaries] = useState<unknown>(null);

  // Address state
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [addressLoading, setAddressLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<AddressStatus | "all">("all");
  const [editingBellCount, setEditingBellCount] = useState<string | null>(null);
  const [bellCountValue, setBellCountValue] = useState("");
  const [editingStatus, setEditingStatus] = useState<string | null>(null);
  const [editingLanguage, setEditingLanguage] = useState<string | null>(null);
  const [languageValue, setLanguageValue] = useState("");

  // Map
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const { isLoaded, mapRef, addSource, addLayer, fitBounds, activeStyle, changeStyle, onStyleReady } = useMapLibre({
    container: mapContainerRef,
    center: [11.38, 47.75],
    zoom: 14,
  });
  const layerAdded = useRef(false);
  const territoryRef = useRef<TerritoryListItem | null>(null);
  const gps = useGpsTracker();

  // Inject GPS marker CSS
  useEffect(() => {
    const styleId = "my-location-marker-style";
    if (!document.getElementById(styleId)) {
      const style = document.createElement("style");
      style.id = styleId;
      style.textContent = MY_LOCATION_MARKER_CSS;
      document.head.appendChild(style);
    }
  }, []);

  // ─── Fetch territory ─────────────────────────────────────────

  useEffect(() => {
    if (!token || !id) return;
    getTerritory(id, token)
      .then((t) => {
        setTerritory(t);
        territoryRef.current = t;
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load territory"))
      .finally(() => setLoading(false));
  }, [token, id]);

  // ─── Fetch addresses ─────────────────────────────────────────

  const fetchAddresses = useCallback(async () => {
    if (!token || !id) return;
    setAddressLoading(true);
    try {
      const res = await listAddresses(id, token, {});
      // API returns raw array or { addresses: [...] } — handle both
      const list = Array.isArray(res) ? res : (res.addresses ?? []);
      setAddresses(list);
    } catch {
      // silently fail
    } finally {
      setAddressLoading(false);
    }
  }, [token, id]);

  useEffect(() => {
    if (id) void fetchAddresses();
  }, [fetchAddresses, id]);

  // ─── Map layers ──────────────────────────────────────────────

  const addBoundaryLayers = useCallback(() => {
    const t = territoryRef.current;
    if (!t?.boundaries) return;

    addSource("territory", {
      type: "FeatureCollection",
      features: [{
        type: "Feature",
        properties: { number: t.number },
        geometry: t.boundaries,
      }],
    });

    addLayer({
      id: "territory-fill", type: "fill", source: "territory",
      paint: { "fill-color": "rgba(217, 119, 6, 0.25)", "fill-opacity": 0.8 },
    });
    addLayer({
      id: "territory-outline", type: "line", source: "territory",
      paint: { "line-color": "#b45309", "line-width": 3 },
    });
    addLayer({
      id: "territory-label", type: "symbol", source: "territory",
      layout: { "text-field": ["get", "number"], "text-size": 16, "text-font": ["Open Sans Bold"] },
      paint: { "text-color": "#1e293b", "text-halo-color": "#ffffff", "text-halo-width": 2 },
    });

    let minLng = 180, maxLng = -180, minLat = 90, maxLat = -90;
    const flatten = (c: unknown): void => {
      if (Array.isArray(c) && typeof c[0] === "number") {
        const pt = c as number[];
        if (pt[0]! < minLng) minLng = pt[0]!;
        if (pt[0]! > maxLng) maxLng = pt[0]!;
        if (pt[1]! < minLat) minLat = pt[1]!;
        if (pt[1]! > maxLat) maxLat = pt[1]!;
      } else if (Array.isArray(c)) {
        for (const item of c) flatten(item);
      }
    };
    flatten((t.boundaries as { coordinates: unknown }).coordinates);
    if (minLng < 180) fitBounds([[minLng, minLat], [maxLng, maxLat]]);
  }, [addSource, addLayer, fitBounds]);

  useEffect(() => {
    onStyleReady(() => {
      layerAdded.current = false;
      addBoundaryLayers();
      layerAdded.current = true;
    });
  }, [onStyleReady, addBoundaryLayers]);

  useEffect(() => {
    if (!isLoaded || !territory?.boundaries || layerAdded.current) return;
    addBoundaryLayers();
    layerAdded.current = true;
  }, [isLoaded, territory, addBoundaryLayers]);

  useEffect(() => {
    const map = mapRef.current;
    if (map && isLoaded) {
      const timer = setTimeout(() => map.resize(), 350);
      return () => clearTimeout(timer);
    }
  }, [mapExpanded, mapRef, isLoaded]);

  // ─── Inline edit handlers ────────────────────────────────────

  const handleSaveBellCount = async (addr: Address) => {
    const val = bellCountValue.trim() === "" ? null : parseInt(bellCountValue, 10);
    if (val !== null && isNaN(val)) return;
    try {
      await updateAddress(addr.territoryId!, addr.addressId, { bellCount: val } as Partial<Address>, token);
      setAddresses((prev) =>
        prev.map((a) => a.addressId === addr.addressId ? { ...a, bellCount: val } : a),
      );
    } catch {
      // silently fail
    }
    setEditingBellCount(null);
  };

  const handleStatusChange = async (addr: Address, newStatus: AddressStatus) => {
    try {
      await updateAddress(addr.territoryId!, addr.addressId, { status: newStatus } as Partial<Address>, token);
      setAddresses((prev) =>
        prev.map((a) => a.addressId === addr.addressId ? { ...a, status: newStatus } : a),
      );
    } catch {
      // silently fail
    }
    setEditingStatus(null);
  };

  const handleSaveLanguage = async (addr: Address) => {
    const val = languageValue.trim() || null;
    try {
      await updateAddress(addr.territoryId!, addr.addressId, { languageSpoken: val } as Partial<Address>, token);
      setAddresses((prev) =>
        prev.map((a) => a.addressId === addr.addressId ? { ...a, languageSpoken: val } : a),
      );
    } catch {
      // silently fail
    }
    setEditingLanguage(null);
  };

  // ─── Derived values ──────────────────────────────────────────

  const hasBoundary = !!territory?.boundaries;

  // ─── Boundary save with auto-fix preview ────────────────────
  const handleBoundarySave = async (boundaries: unknown) => {
    if (!token || !territory) return;
    try {
      const result = await previewFix(token, territory.id, boundaries);
      if (result.geometryModified) {
        setAutoFixResult(result);
        setPendingBoundaries(result.clipped);
      } else {
        await saveBoundary(result.clipped);
      }
    } catch (err) {
      console.error("Preview fix failed:", err);
    }
  };

  const saveBoundary = async (boundaries: unknown) => {
    if (!token || !territory) return;
    try {
      await updateTerritoryBoundaries(token, territory.id, boundaries);
      setEditMode(false);
      setCreationMode(false);
      setAutoFixResult(null);
      setPendingBoundaries(null);
      const refreshed = await getTerritory(territory.id, token);
      setTerritory(refreshed);
      territoryRef.current = refreshed;
    } catch (err) {
      console.error("Save boundary failed:", err);
    }
  };

  const handleCreationComplete = (coords: [number, number][]) => {
    // coords is already a closed ring from CreationFlow
    const geojson = { type: "Polygon", coordinates: [coords] };
    handleBoundarySave(geojson);
  };
  const activeAssignment = territory?.assignments?.find((a) => !a.returnedAt);
  const pastAssignments = territory?.assignments?.filter((a) => a.returnedAt) ?? [];

  // Address filtering
  const filteredAddresses = addresses
    .filter((a) => {
      if (statusFilter !== "all" && a.status !== statusFilter) return false;
      if (a.status === "archived") return false;
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
    .sort((a, b) => a.sortOrder - b.sortOrder);

  // Address stats
  const totalAddresses = addresses.filter((a) => a.status !== "archived").length;
  const dncCount = addresses.filter((a) => a.status === "do_not_call").length;
  const notAtHomeCount = addresses.filter((a) => a.status === "not_at_home").length;
  const totalBells = addresses.reduce((sum, a) => sum + (a.bellCount ?? 1), 0);

  // ─── Loading / error ─────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 size={24} className="text-[var(--amber)] animate-spin" />
      </div>
    );
  }

  if (error || !territory) {
    return (
      <div className="space-y-4">
        <button onClick={() => navigate("/territories")} className="p-2 text-[var(--text-muted)] hover:text-[var(--text)] cursor-pointer">
          <ArrowLeft size={18} />
        </button>
        <p className="text-sm text-[var(--red)]">{error ?? "Territory not found"}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate("/territories")}
          className="p-2 rounded-[var(--radius-sm)] text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--glass)] transition-colors cursor-pointer"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-semibold text-[var(--text)]">
            <span className="text-[var(--amber)] font-mono">#{territory.number}</span>
            {" "}
            {territory.name}
          </h1>
          {territory.description && (
            <p className="text-sm text-[var(--text-muted)] mt-0.5">{territory.description}</p>
          )}
        </div>
        <button
          onClick={() => navigate("/territories/map")}
          className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--glass)] transition-colors cursor-pointer"
        >
          <Layers size={14} />
          <FormattedMessage id="territories.viewOnMap" defaultMessage="View on Map" />
        </button>
      </div>

      {/* Content grid */}
      <div className={mapExpanded ? "space-y-6" : "grid grid-cols-1 lg:grid-cols-3 gap-6"}>
        {/* Map panel */}
        <div className={`${mapExpanded ? "" : "lg:col-span-2"} border border-[var(--border)] rounded-[var(--radius)] overflow-hidden bg-[var(--bg-1)] relative`}>
          <div
            ref={mapContainerRef}
            className={`w-full transition-[height] duration-300 ${
              hasBoundary || creationMode
                ? mapExpanded ? "h-[70vh]" : "h-80"
                : "h-0 overflow-hidden"
            }`}
          />

          {!hasBoundary && !creationMode && (
            <div className="h-80 flex items-center justify-center">
              <div className="text-center">
                <MapPin size={36} className="text-[var(--text-muted)] mx-auto mb-3" strokeWidth={1.5} />
                <p className="text-sm text-[var(--text-muted)] mb-3">
                  <FormattedMessage id="territories.noBoundary" defaultMessage="No boundary defined" />
                </p>
                {can("app:territories.edit") && (
                  <button
                    onClick={() => setCreationMode(true)}
                    className="flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-[var(--amber)] text-black rounded-[var(--radius-sm)] hover:bg-[var(--amber-light)] transition-colors mx-auto"
                  >
                    <MapPin size={16} />
                    <FormattedMessage id="territories.drawBoundary" defaultMessage="Draw Boundary" />
                  </button>
                )}
              </div>
            </div>
          )}

          {creationMode && !hasBoundary && isLoaded && (
            <CreationFlow
              map={mapRef.current}
              onComplete={handleCreationComplete}
              onCancel={() => setCreationMode(false)}
            />
          )}

          {hasBoundary && isLoaded && (
            <>
              <div className="absolute top-3 left-3 z-10 flex rounded-[var(--radius-sm)] overflow-hidden shadow-lg border border-[var(--border)]">
                {(Object.keys(MAP_STYLES) as MapStyleKey[]).map((key) => (
                  <button
                    key={key}
                    onClick={() => changeStyle(key)}
                    className={`px-2.5 py-1 text-[11px] font-medium transition-colors cursor-pointer ${
                      activeStyle === key
                        ? "bg-[var(--amber)] text-black"
                        : "bg-[var(--bg-1)] text-[var(--text-muted)] hover:bg-[var(--glass)] hover:text-[var(--text)]"
                    }`}
                  >
                    {MAP_STYLES[key].label}
                  </button>
                ))}
              </div>
              <div className="absolute top-3 right-3 z-10 flex gap-1.5">
                <button
                  onClick={gps.toggle}
                  title={gps.active ? "Disable GPS" : "Enable GPS"}
                  className={`p-2 rounded-[var(--radius-sm)] border border-[var(--border)] transition-colors cursor-pointer shadow-lg ${
                    gps.active
                      ? "bg-[var(--blue)] text-white"
                      : "bg-[var(--bg-1)] text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--glass)]"
                  }`}
                >
                  <MapPin size={16} />
                </button>
                <button
                  onClick={() => navigate(`/territories/${id}/field-work`)}
                  className="px-2.5 py-1.5 rounded-[var(--radius-sm)] bg-[var(--blue)] text-white text-[11px] font-semibold border border-[var(--blue)] hover:opacity-90 transition-opacity cursor-pointer shadow-lg"
                >
                  Field Work
                </button>
                {can("app:territories.edit") && !editMode && (
                  <button
                    onClick={() => setEditMode(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-amber-500/80 text-black rounded-[var(--radius-sm)] hover:bg-amber-400 transition-colors cursor-pointer shadow-lg"
                  >
                    <Edit3 size={13} />
                    <FormattedMessage id="territories.edit" defaultMessage="Edit" />
                  </button>
                )}
                <button
                  onClick={() => setMapExpanded((v) => !v)}
                  className="p-2 rounded-[var(--radius-sm)] bg-[var(--bg-1)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--glass)] transition-colors cursor-pointer shadow-lg"
                >
                  {mapExpanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                </button>
              </div>
              <MyLocationMarker
                map={mapRef.current}
                lat={gps.lat}
                lng={gps.lng}
                heading={gps.heading}
                accuracy={gps.accuracy}
                visible={gps.active}
              />
            </>
          )}
        </div>

        {/* Info sidebar */}
        <div className={`space-y-4 ${mapExpanded ? "grid grid-cols-1 sm:grid-cols-3 gap-4 space-y-0" : ""}`}>
          <div className="border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)] p-4">
            <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-3 flex items-center gap-2">
              <User size={12} />
              <FormattedMessage id="territories.currentAssignment" defaultMessage="Current Assignment" />
            </h3>
            {activeAssignment ? (
              <div className="flex items-center gap-3 p-3 rounded-[var(--radius-sm)] bg-[var(--glass)]">
                <div className="w-9 h-9 rounded-full bg-[var(--amber)] bg-opacity-20 flex items-center justify-center flex-shrink-0">
                  <User size={16} className="text-[var(--amber)]" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[var(--text)] truncate">
                    {activeAssignment.publisher.firstName} {activeAssignment.publisher.lastName}
                  </p>
                  <p className="text-xs text-[var(--text-muted)]">
                    <FormattedMessage id="territories.since" defaultMessage="Since" />{" "}
                    <FormattedDate value={activeAssignment.assignedAt} />
                  </p>
                </div>
              </div>
            ) : (
              <div className="p-3 rounded-[var(--radius-sm)] bg-[var(--glass)] text-center">
                <p className="text-sm text-[var(--text-muted)] italic">
                  <FormattedMessage id="territories.notAssigned" defaultMessage="Not assigned" />
                </p>
              </div>
            )}
          </div>

          {/* Stats row */}
          <div className={`${mapExpanded ? "flex gap-3" : "grid grid-cols-2 gap-3"}`}>
            <div className="border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)] p-3 text-center flex-1">
              <div className="flex items-center justify-center gap-1.5 mb-1">
                <MapPin size={12} className="text-[var(--text-muted)]" />
                <p className="text-lg font-bold text-[var(--text)]">{totalAddresses}</p>
              </div>
              <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide">
                <FormattedMessage id="territories.addresses" defaultMessage="Addresses" />
              </p>
            </div>
            <div className="border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)] p-3 text-center flex-1">
              <div className="flex items-center justify-center gap-1.5 mb-1">
                <Bell size={12} className="text-[var(--text-muted)]" />
                <p className="text-lg font-bold text-[var(--text)]">{totalBells}</p>
              </div>
              <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide">
                <FormattedMessage id="territories.bellCount" defaultMessage="Doorbells" />
              </p>
            </div>
          </div>

          {/* Mini stats */}
          <div className="border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)] p-4 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-[var(--text-muted)] flex items-center gap-1.5">
                <Ban size={11} className="text-[var(--red)]" />
                <FormattedMessage id="territories.doNotCall" defaultMessage="Do Not Call" />
              </span>
              <span className="text-[var(--text)] font-mono">{dncCount}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-[var(--text-muted)] flex items-center gap-1.5">
                <Home size={11} className="text-[var(--amber)]" />
                <FormattedMessage id="territories.notAtHome" defaultMessage="Not at Home" />
              </span>
              <span className="text-[var(--text)] font-mono">{notAtHomeCount}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-[var(--text-muted)] flex items-center gap-1.5">
                <Hash size={11} />
                <FormattedMessage id="territories.totalAssignments" defaultMessage="Assignments" />
              </span>
              <span className="text-[var(--text)] font-mono">{territory.assignments?.length ?? 0}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-[var(--text-muted)] flex items-center gap-1.5"><Clock size={11} /><FormattedMessage id="territories.created" defaultMessage="Created" /></span>
              <span className="text-[var(--text)]"><FormattedDate value={territory.createdAt} /></span>
            </div>
          </div>
        </div>
      </div>

      {/* ─── Tabs ──────────────────────────────────────────────── */}
      <div className="border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)] overflow-hidden">
        {/* Tab bar */}
        <div className="flex border-b border-[var(--border)]">
          {([
            { id: "addresses" as TabId, label: intl.formatMessage({ id: "territories.addresses", defaultMessage: "Addresses" }), count: totalAddresses },
            { id: "history" as TabId, label: intl.formatMessage({ id: "territories.assignmentHistory", defaultMessage: "Assignment History" }), count: pastAssignments.length },
          ]).map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 sm:flex-none px-6 py-3 text-sm font-medium transition-colors cursor-pointer border-b-2 ${
                activeTab === tab.id
                  ? "border-[var(--amber)] text-[var(--text)]"
                  : "border-transparent text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--glass)]"
              }`}
            >
              {tab.label}
              <span className="ml-2 text-xs text-[var(--text-muted)]">({tab.count})</span>
            </button>
          ))}
        </div>

        {/* Tab content */}
        {activeTab === "addresses" && (
          <div>
            {/* Address toolbar */}
            <div className="p-4 border-b border-[var(--border)] flex flex-wrap items-center gap-3">
              <div className="relative flex-1 min-w-[200px]">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={intl.formatMessage({ id: "common.search", defaultMessage: "Search..." })}
                  className="w-full pl-8 pr-3 py-1.5 text-sm bg-[var(--bg)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--amber)]"
                />
              </div>
              <div className="flex items-center gap-2">
                <Filter size={12} className="text-[var(--text-muted)]" />
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as AddressStatus | "all")}
                  className="bg-[var(--bg)] border border-[var(--border)] rounded-[var(--radius-sm)] px-2 py-1.5 text-[var(--text)] text-xs cursor-pointer"
                >
                  <option value="all">{intl.formatMessage({ id: "common.all", defaultMessage: "All" })}</option>
                  <option value="active">Active</option>
                  <option value="do_not_call">Do Not Call</option>
                  <option value="not_at_home">Not at Home</option>
                  <option value="moved">Moved</option>
                  <option value="foreign_language">Foreign Language</option>
                </select>
              </div>
            </div>

            {/* Address table */}
            {addressLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 size={20} className="text-[var(--amber)] animate-spin" />
              </div>
            ) : filteredAddresses.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-[var(--text-muted)]">
                <MapPin size={28} strokeWidth={1.2} className="mb-2" />
                <p className="text-xs">
                  <FormattedMessage id="territories.noAddresses" defaultMessage="No addresses found" />
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">
                      <th className="text-left px-4 py-2 font-medium">#</th>
                      <th className="text-left px-4 py-2 font-medium">
                        <FormattedMessage id="territories.street" defaultMessage="Street" />
                      </th>
                      <th className="text-left px-4 py-2 font-medium">
                        <FormattedMessage id="territories.city" defaultMessage="City" />
                      </th>
                      <th className="text-center px-4 py-2 font-medium">
                        <Bell size={11} className="inline" />
                      </th>
                      <th className="text-left px-4 py-2 font-medium">
                        <FormattedMessage id="territories.status" defaultMessage="Status" />
                      </th>
                      <th className="text-left px-4 py-2 font-medium">
                        <FormattedMessage id="territories.language" defaultMessage="Language" />
                      </th>
                      <th className="text-left px-4 py-2 font-medium">
                        <FormattedMessage id="territories.lastVisit" defaultMessage="Last Visit" />
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {filteredAddresses.map((addr, idx) => {
                      const meta = STATUS_META[addr.status] ?? STATUS_META.active!;
                      const StatusIcon = meta.icon;
                      const TypeIcon = TYPE_ICONS[addr.type] ?? Home;

                      return (
                        <tr
                          key={addr.addressId}
                          className={`transition-colors hover:bg-[var(--glass)] ${meta.dimmed ? "opacity-60" : ""}`}
                        >
                          {/* Row number */}
                          <td className="px-4 py-2.5 text-xs text-[var(--text-muted)] font-mono">
                            {idx + 1}
                          </td>

                          {/* Street address */}
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-2">
                              <TypeIcon size={13} className="text-[var(--text-muted)] flex-shrink-0" />
                              <div className="min-w-0">
                                <div className="text-sm text-[var(--text)] truncate">
                                  {addr.streetAddress}
                                  {addr.apartment && (
                                    <span className="text-[var(--text-muted)] ml-1">/ {addr.apartment}</span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </td>

                          {/* City */}
                          <td className="px-4 py-2.5 text-xs text-[var(--text-muted)]">
                            {addr.postalCode} {addr.city}
                          </td>

                          {/* Bell count — inline editable */}
                          <td className="px-4 py-2.5 text-center">
                            {editingBellCount === addr.addressId ? (
                              <div className="flex items-center justify-center gap-1">
                                <input
                                  type="number"
                                  min={0}
                                  max={999}
                                  value={bellCountValue}
                                  onChange={(e) => setBellCountValue(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") handleSaveBellCount(addr);
                                    if (e.key === "Escape") setEditingBellCount(null);
                                  }}
                                  autoFocus
                                  className="w-12 px-1 py-0.5 text-xs text-center bg-[var(--bg)] border border-[var(--amber)] rounded text-[var(--text)] focus:outline-none"
                                />
                                <button onClick={() => handleSaveBellCount(addr)} className="text-[var(--green)] cursor-pointer">
                                  <Check size={12} />
                                </button>
                                <button onClick={() => setEditingBellCount(null)} className="text-[var(--text-muted)] cursor-pointer">
                                  <X size={12} />
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => {
                                  setEditingBellCount(addr.addressId);
                                  setBellCountValue(addr.bellCount?.toString() ?? "");
                                }}
                                className="px-2 py-0.5 text-xs font-mono text-[var(--text)] hover:bg-[var(--glass-2)] rounded cursor-pointer transition-colors"
                                title={intl.formatMessage({ id: "territories.editBellCount", defaultMessage: "Edit bell count" })}
                              >
                                {addr.bellCount ?? "–"}
                              </button>
                            )}
                          </td>

                          {/* Status — inline editable */}
                          <td className="px-4 py-2.5">
                            {editingStatus === addr.addressId ? (
                              <div className="relative">
                                <select
                                  value={addr.status}
                                  onChange={(e) => handleStatusChange(addr, e.target.value as AddressStatus)}
                                  onBlur={() => setEditingStatus(null)}
                                  autoFocus
                                  className="bg-[var(--bg)] border border-[var(--amber)] rounded px-2 py-0.5 text-xs text-[var(--text)] cursor-pointer focus:outline-none"
                                >
                                  {STATUS_OPTIONS.map((opt) => (
                                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                                  ))}
                                </select>
                              </div>
                            ) : (
                              <button
                                onClick={() => setEditingStatus(addr.addressId)}
                                className={`flex items-center gap-1.5 px-2 py-0.5 rounded hover:bg-[var(--glass-2)] cursor-pointer transition-colors ${meta.color}`}
                                title={intl.formatMessage({ id: "territories.changeStatus", defaultMessage: "Change status" })}
                              >
                                <StatusIcon size={13} />
                                <span className="text-xs">{meta.label}</span>
                                <ChevronDown size={10} className="text-[var(--text-muted)]" />
                              </button>
                            )}
                          </td>

                          {/* Language — inline editable */}
                          <td className="px-4 py-2.5">
                            {editingLanguage === addr.addressId ? (
                              <div className="flex items-center gap-1">
                                <input
                                  type="text"
                                  value={languageValue}
                                  onChange={(e) => setLanguageValue(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") handleSaveLanguage(addr);
                                    if (e.key === "Escape") setEditingLanguage(null);
                                  }}
                                  autoFocus
                                  placeholder="de, en, tr..."
                                  className="w-16 px-1 py-0.5 text-xs bg-[var(--bg)] border border-[var(--amber)] rounded text-[var(--text)] focus:outline-none"
                                />
                                <button onClick={() => handleSaveLanguage(addr)} className="text-[var(--green)] cursor-pointer">
                                  <Check size={12} />
                                </button>
                                <button onClick={() => setEditingLanguage(null)} className="text-[var(--text-muted)] cursor-pointer">
                                  <X size={12} />
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => {
                                  setEditingLanguage(addr.addressId);
                                  setLanguageValue(addr.languageSpoken ?? "");
                                }}
                                className="px-2 py-0.5 text-xs rounded hover:bg-[var(--glass-2)] cursor-pointer transition-colors"
                                title={intl.formatMessage({ id: "territories.setLanguage", defaultMessage: "Set language" })}
                              >
                                {addr.languageSpoken ? (
                                  <span className="px-1.5 py-0 rounded-full bg-[var(--glass)] text-[var(--blue)]">
                                    {addr.languageSpoken}
                                  </span>
                                ) : (
                                  <span className="text-[var(--text-muted)] italic">—</span>
                                )}
                              </button>
                            )}
                          </td>

                          {/* Last visit */}
                          <td className="px-4 py-2.5 text-xs text-[var(--text-muted)]">
                            {addr.lastVisitDate ? (
                              <div>
                                <div>{new Date(addr.lastVisitDate).toLocaleDateString()}</div>
                                {addr.lastVisitOutcome && (
                                  <div className="text-[10px]">
                                    {addr.lastVisitOutcome.replace(/_/g, " ")}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <span className="text-[var(--text-muted)] italic">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {activeTab === "history" && (
          <div>
            {pastAssignments.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-[var(--text-muted)]">
                <Calendar size={28} strokeWidth={1.2} className="mb-2" />
                <p className="text-xs">
                  <FormattedMessage id="territories.noHistory" defaultMessage="No assignment history" />
                </p>
              </div>
            ) : (
              <div className="divide-y divide-[var(--border)]">
                {pastAssignments.map((a) => (
                  <div key={a.id} className="px-4 py-3 flex items-center gap-3">
                    <div className="w-7 h-7 rounded-full bg-[var(--glass)] flex items-center justify-center flex-shrink-0">
                      <User size={12} className="text-[var(--text-muted)]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-[var(--text)] truncate">
                        {a.publisher.firstName} {a.publisher.lastName}
                      </p>
                      <p className="text-xs text-[var(--text-muted)]">
                        <FormattedDate value={a.assignedAt} /> — <FormattedDate value={a.returnedAt!} />
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Version History */}
      {hasBoundary && territory && (
        <VersionHistory
          territoryId={territory.id}
          token={token}
          canEdit={can("app:territories.edit")}
          onRestore={(result) => {
            if (result.geometryModified) {
              setAutoFixResult(result);
              setPendingBoundaries(result.clipped);
            } else {
              saveBoundary(result.clipped);
            }
          }}
        />
      )}

      {/* Auto-Fix Preview dialog */}
      {autoFixResult && (
        <AutoFixPreview
          result={autoFixResult}
          onAccept={() => saveBoundary(pendingBoundaries)}
          onCancel={() => {
            setAutoFixResult(null);
            setPendingBoundaries(null);
          }}
        />
      )}
    </div>
  );
}

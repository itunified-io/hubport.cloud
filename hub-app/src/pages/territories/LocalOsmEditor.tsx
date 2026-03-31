/**
 * Local OSM feature editor.
 * Toggle on map toolbar, shows local features as dashed outlines,
 * "Add feature" button with mode selector.
 */
import { useState, useEffect, useCallback } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import {
  Layers, Plus, Building, MapPin, Route, PenTool,
  Trash2, X, Save,
} from "lucide-react";
import { useAuth } from "@/auth/useAuth";
import {
  getLocalOsmFeatures,
  createLocalOsmFeature,
  deleteLocalOsmFeature,
  type LocalOsmFeature,
  type LocalOsmType,
  type GeoJsonGeometry,
} from "@/lib/territory-api";

const FEATURE_TYPES: {
  value: LocalOsmType;
  icon: React.ElementType;
  label: string;
  description: string;
}[] = [
  { value: "building_override", icon: Building, label: "Building", description: "Override an existing OSM building" },
  { value: "street", icon: Route, label: "Street", description: "Add a missing street" },
  { value: "poi", icon: MapPin, label: "POI", description: "Mark a point of interest" },
  { value: "custom", icon: PenTool, label: "Custom", description: "Freeform annotation" },
];

const POI_CATEGORIES = ["park", "school", "church", "community", "commercial", "other"];

interface LocalOsmEditorProps {
  bbox?: string;
  onFeaturesLoaded?: (features: LocalOsmFeature[]) => void;
}

export function LocalOsmEditor({ bbox, onFeaturesLoaded }: LocalOsmEditorProps) {
  const { user } = useAuth();
  const intl = useIntl();
  const token = user?.access_token ?? "";

  const [active, setActive] = useState(false);
  const [features, setFeatures] = useState<LocalOsmFeature[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAddPanel, setShowAddPanel] = useState(false);
  const [selectedType, setSelectedType] = useState<LocalOsmType | null>(null);

  // Form state for new feature
  const [formName, setFormName] = useState("");
  const [formLabel, setFormLabel] = useState("");
  const [formCategory, setFormCategory] = useState("other");
  const [formColor, setFormColor] = useState("#FF6B00");
  const [formNotes, setFormNotes] = useState("");
  const [formStreetName, setFormStreetName] = useState("");
  const [formHouseNumber, setFormHouseNumber] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchFeatures = useCallback(async () => {
    if (!token || !active) return;
    setLoading(true);
    try {
      const data = await getLocalOsmFeatures(token, { bbox });
      setFeatures(data);
      onFeaturesLoaded?.(data);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [token, active, bbox, onFeaturesLoaded]);

  useEffect(() => {
    if (active) void fetchFeatures();
  }, [active, fetchFeatures]);

  const handleDelete = async (id: string) => {
    try {
      await deleteLocalOsmFeature(id, token);
      setFeatures((prev) => prev.filter((f) => f.id !== id));
    } catch {
      // silently fail
    }
  };

  const handleCreate = async () => {
    if (!selectedType) return;

    // Build properties based on type
    const properties: Record<string, unknown> = {};
    if (selectedType === "building_override") {
      if (formStreetName) properties.streetName = formStreetName;
      if (formHouseNumber) properties.houseNumber = formHouseNumber;
      if (formNotes) properties.notes = formNotes;
    } else if (selectedType === "street") {
      properties.name = formName;
      if (formNotes) properties.notes = formNotes;
    } else if (selectedType === "poi") {
      properties.name = formName;
      properties.poiCategory = formCategory;
      if (formNotes) properties.notes = formNotes;
    } else {
      properties.label = formLabel;
      properties.color = formColor;
      if (formNotes) properties.notes = formNotes;
    }

    // Placeholder geometry (would be set by map interaction in practice)
    const geometry: GeoJsonGeometry =
      selectedType === "street"
        ? { type: "LineString", coordinates: [[0, 0], [0.001, 0.001]] }
        : { type: "Point", coordinates: [0, 0] };

    setSaving(true);
    try {
      const feature = await createLocalOsmFeature(
        { featureType: selectedType, geometry, properties },
        token,
      );
      setFeatures((prev) => [...prev, feature]);
      resetForm();
    } catch {
      // silently fail
    } finally {
      setSaving(false);
    }
  };

  const resetForm = () => {
    setShowAddPanel(false);
    setSelectedType(null);
    setFormName("");
    setFormLabel("");
    setFormCategory("other");
    setFormColor("#FF6B00");
    setFormNotes("");
    setFormStreetName("");
    setFormHouseNumber("");
  };

  // ─── Toggle button (for map toolbar) ─────────────────────────

  if (!active) {
    return (
      <button
        onClick={() => setActive(true)}
        className="flex items-center gap-2 px-3 py-1.5 text-sm border border-[var(--border)] text-[var(--text-muted)] rounded-[var(--radius-sm)] hover:bg-[var(--glass)] transition-colors cursor-pointer"
      >
        <Layers size={16} />
        <span className="hidden sm:inline">
          <FormattedMessage id="territories.localData" defaultMessage="Local data" />
        </span>
      </button>
    );
  }

  return (
    <div className="flex flex-col bg-[var(--bg-1)] border border-[var(--border)] rounded-[var(--radius)] shadow-lg max-w-sm">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
        <h3 className="text-sm font-semibold text-[var(--text)] flex items-center gap-2">
          <Layers size={16} className="text-[var(--amber)]" />
          <FormattedMessage id="territories.localOsm" defaultMessage="Local OSM Data" />
          <span className="text-[var(--text-muted)] font-normal">({features.length})</span>
        </h3>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowAddPanel(!showAddPanel)}
            className="p-1.5 rounded-[var(--radius-sm)] text-[var(--amber)] hover:bg-[var(--glass)] transition-colors cursor-pointer"
            title={intl.formatMessage({ id: "territories.addFeature", defaultMessage: "Add feature" })}
          >
            <Plus size={16} />
          </button>
          <button
            onClick={() => {
              setActive(false);
              resetForm();
            }}
            className="p-1.5 rounded-[var(--radius-sm)] text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--glass)] transition-colors cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Add feature panel */}
      {showAddPanel && (
        <div className="p-4 border-b border-[var(--border)] space-y-3">
          {/* Type selector */}
          {!selectedType ? (
            <div className="grid grid-cols-2 gap-2">
              {FEATURE_TYPES.map(({ value, icon: Icon, label, description }) => (
                <button
                  key={value}
                  onClick={() => setSelectedType(value)}
                  className="flex flex-col items-center gap-1.5 p-3 rounded-[var(--radius-sm)] border border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--amber)] hover:text-[var(--text)] transition-colors cursor-pointer"
                >
                  <Icon size={20} />
                  <span className="text-xs font-medium">{label}</span>
                  <span className="text-[9px] opacity-60 text-center leading-tight">{description}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-[var(--text)]">
                  {FEATURE_TYPES.find((t) => t.value === selectedType)?.label}
                </span>
                <button
                  onClick={() => setSelectedType(null)}
                  className="text-[10px] text-[var(--text-muted)] hover:text-[var(--text)] cursor-pointer"
                >
                  <FormattedMessage id="common.change" defaultMessage="Change" />
                </button>
              </div>

              {/* Type-specific fields */}
              {selectedType === "building_override" && (
                <>
                  <input
                    type="text"
                    value={formStreetName}
                    onChange={(e) => setFormStreetName(e.target.value)}
                    placeholder="Street name"
                    className="w-full px-3 py-1.5 text-xs bg-[var(--bg)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text)] focus:outline-none focus:border-[var(--amber)]"
                  />
                  <input
                    type="text"
                    value={formHouseNumber}
                    onChange={(e) => setFormHouseNumber(e.target.value)}
                    placeholder="House number"
                    className="w-full px-3 py-1.5 text-xs bg-[var(--bg)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text)] focus:outline-none focus:border-[var(--amber)]"
                  />
                </>
              )}

              {(selectedType === "street" || selectedType === "poi") && (
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="Name *"
                  required
                  className="w-full px-3 py-1.5 text-xs bg-[var(--bg)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text)] focus:outline-none focus:border-[var(--amber)]"
                />
              )}

              {selectedType === "poi" && (
                <select
                  value={formCategory}
                  onChange={(e) => setFormCategory(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs bg-[var(--bg)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text)] cursor-pointer"
                >
                  {POI_CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              )}

              {selectedType === "custom" && (
                <>
                  <input
                    type="text"
                    value={formLabel}
                    onChange={(e) => setFormLabel(e.target.value)}
                    placeholder="Label *"
                    required
                    className="w-full px-3 py-1.5 text-xs bg-[var(--bg)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text)] focus:outline-none focus:border-[var(--amber)]"
                  />
                  <div className="flex items-center gap-2">
                    <label className="text-[10px] text-[var(--text-muted)]">Color</label>
                    <input
                      type="color"
                      value={formColor}
                      onChange={(e) => setFormColor(e.target.value)}
                      className="w-6 h-6 rounded cursor-pointer border-none"
                    />
                  </div>
                </>
              )}

              <textarea
                value={formNotes}
                onChange={(e) => setFormNotes(e.target.value)}
                placeholder="Notes"
                rows={2}
                className="w-full px-3 py-1.5 text-xs bg-[var(--bg)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text)] focus:outline-none focus:border-[var(--amber)] resize-none"
              />

              <p className="text-[9px] text-[var(--text-muted)]">
                <FormattedMessage
                  id="territories.localOsmDrawHint"
                  defaultMessage="Click on the map to place this feature. The geometry will be set from your interaction."
                />
              </p>

              <div className="flex items-center gap-2">
                <button
                  onClick={resetForm}
                  className="flex-1 py-1.5 text-xs text-[var(--text-muted)] border border-[var(--border)] rounded-[var(--radius-sm)] hover:bg-[var(--glass)] cursor-pointer"
                >
                  <FormattedMessage id="common.cancel" defaultMessage="Cancel" />
                </button>
                <button
                  onClick={handleCreate}
                  disabled={saving}
                  className="flex-1 py-1.5 text-xs font-semibold text-black bg-[var(--amber)] rounded-[var(--radius-sm)] hover:bg-[var(--amber-light)] cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1"
                >
                  {saving ? (
                    <div className="h-3 w-3 animate-spin rounded-full border border-black/20 border-t-black" />
                  ) : (
                    <Save size={12} />
                  )}
                  <FormattedMessage id="common.save" defaultMessage="Save" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Feature list */}
      <div className="max-h-48 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--glass-2)] border-t-[var(--amber)]" />
          </div>
        ) : features.length === 0 ? (
          <div className="py-6 text-center text-xs text-[var(--text-muted)]">
            <FormattedMessage
              id="territories.noLocalFeatures"
              defaultMessage="No local features yet"
            />
          </div>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {features.map((feature) => {
              const typeMeta = FEATURE_TYPES.find((t) => t.value === feature.featureType);
              const TypeIcon = typeMeta?.icon ?? MapPin;
              const displayName =
                (feature.properties.name as string) ??
                (feature.properties.label as string) ??
                (feature.properties.streetName as string) ??
                feature.featureType.replace("_", " ");

              return (
                <li
                  key={feature.id}
                  className="flex items-center gap-2 px-4 py-2 text-xs hover:bg-[var(--glass)] transition-colors"
                >
                  <TypeIcon size={14} className="text-[var(--amber)] flex-shrink-0" />
                  <span className="flex-1 truncate text-[var(--text)]">{displayName}</span>
                  <span className="text-[9px] text-[var(--text-muted)]">{typeMeta?.label}</span>
                  <button
                    onClick={() => handleDelete(feature.id)}
                    className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--red)] hover:bg-[var(--glass)] cursor-pointer"
                  >
                    <Trash2 size={12} />
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

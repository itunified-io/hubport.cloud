import { useCallback, useState } from "react";
import { getApiUrl } from "../lib/config";

export type EditorMode = "view" | "edit" | "create" | "split";

export interface Territory {
  id: string;
  number: string;
  name: string;
  description?: string;
  boundaries?: object | null;
}

interface SnapContextResponse {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    properties: {
      snapType: string;
      osmId?: string;
      name?: string;
      [key: string]: unknown;
    };
    geometry: { type: string; coordinates: any };
  }>;
}

export interface UseTerritoryEditorReturn {
  /** Currently selected territory */
  selectedTerritory: Territory | null;
  /** Select a territory for viewing/editing */
  selectTerritory: (territory: Territory | null) => void;
  /** Current editor mode */
  mode: EditorMode;
  /** Set the editor mode */
  setMode: (mode: EditorMode) => void;
  /** Snap context GeoJSON for the current viewport */
  snapContext: SnapContextResponse | null;
  /** Whether snap context is loading */
  snapContextLoading: boolean;
  /** Fetch snap context for a bounding box */
  fetchSnapContext: (
    bbox: [number, number, number, number],
  ) => Promise<void>;
  /** Save territory boundaries */
  saveBoundaries: (
    territoryId: string,
    boundaries: object,
  ) => Promise<void>;
  /** Whether save is in progress */
  saving: boolean;
  /** Last save error */
  saveError: string | null;
}

/**
 * Hook managing the territory editor state:
 * selected territory, edit mode, snap context, and save operations.
 */
export function useTerritoryEditor(): UseTerritoryEditorReturn {
  const [selectedTerritory, setSelectedTerritory] = useState<Territory | null>(
    null,
  );
  const [mode, setMode] = useState<EditorMode>("view");
  const [snapContext, setSnapContext] = useState<SnapContextResponse | null>(
    null,
  );
  const [snapContextLoading, setSnapContextLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const selectTerritory = useCallback((territory: Territory | null) => {
    setSelectedTerritory(territory);
    if (!territory) {
      setMode("view");
    }
  }, []);

  const fetchSnapContext = useCallback(
    async (bbox: [number, number, number, number]) => {
      setSnapContextLoading(true);
      try {
        const apiUrl = getApiUrl();
        const bboxStr = bbox.join(",");
        const response = await fetch(
          `${apiUrl}/territories/snap-context?bbox=${bboxStr}`,
          { credentials: "include" },
        );

        if (!response.ok) {
          throw new Error(`Failed to fetch snap context: ${response.status}`);
        }

        const data = (await response.json()) as SnapContextResponse;
        setSnapContext(data);
      } catch (err) {
        console.error("Failed to fetch snap context:", err);
      } finally {
        setSnapContextLoading(false);
      }
    },
    [],
  );

  const saveBoundaries = useCallback(
    async (territoryId: string, boundaries: object) => {
      setSaving(true);
      setSaveError(null);
      try {
        const apiUrl = getApiUrl();
        const response = await fetch(`${apiUrl}/territories/${territoryId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ boundaries }),
        });

        if (!response.ok) {
          const errorBody = await response.json().catch(() => ({}));
          throw new Error(
            (errorBody as Record<string, string>).message ??
              `Save failed: ${response.status}`,
          );
        }

        // Update local state
        setSelectedTerritory((prev) =>
          prev && prev.id === territoryId
            ? { ...prev, boundaries }
            : prev,
        );
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Unknown save error";
        setSaveError(message);
        throw err;
      } finally {
        setSaving(false);
      }
    },
    [],
  );

  return {
    selectedTerritory,
    selectTerritory,
    mode,
    setMode,
    snapContext,
    snapContextLoading,
    fetchSnapContext,
    saveBoundaries,
    saving,
    saveError,
  };
}

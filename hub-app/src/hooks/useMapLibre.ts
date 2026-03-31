import { useCallback, useEffect, useRef, useState } from "react";

/**
 * MapLibre GL JS map instance lifecycle hook.
 *
 * Note: MapLibre GL JS is not yet in dependencies — this hook provides
 * the interface contract. When maplibre-gl is added to package.json,
 * the actual Map class will be imported here.
 *
 * For now, we define a minimal MapInstance interface so consumers can
 * type against it without the dependency.
 */

export interface MapInstance {
  addSource: (id: string, source: object) => void;
  addLayer: (layer: object, beforeId?: string) => void;
  removeLayer: (id: string) => void;
  removeSource: (id: string) => void;
  getSource: (id: string) => object | undefined;
  getLayer: (id: string) => object | undefined;
  fitBounds: (
    bounds: [[number, number], [number, number]],
    options?: object,
  ) => void;
  getCanvas: () => HTMLCanvasElement;
  getContainer: () => HTMLElement;
  on: (event: string, layerOrHandler: string | ((...args: any[]) => void), handler?: (...args: any[]) => void) => void;
  off: (event: string, layerOrHandler: string | ((...args: any[]) => void), handler?: (...args: any[]) => void) => void;
  remove: () => void;
  resize: () => void;
  project: (lngLat: [number, number]) => { x: number; y: number };
  unproject: (point: { x: number; y: number }) => {
    lng: number;
    lat: number;
  };
}

export interface UseMapLibreOptions {
  /** Container element ref */
  container: React.RefObject<HTMLDivElement | null>;
  /** Initial center [lng, lat] */
  center?: [number, number];
  /** Initial zoom level */
  zoom?: number;
  /** Map style URL */
  style?: string;
}

export interface UseMapLibreReturn {
  /** Map instance ref — null until loaded */
  mapRef: React.RefObject<MapInstance | null>;
  /** Whether the map has finished initial load */
  isLoaded: boolean;
  /** Add a GeoJSON source to the map */
  addSource: (id: string, data: object) => void;
  /** Add a layer to the map */
  addLayer: (layer: object, beforeId?: string) => void;
  /** Fit the map to bounds */
  fitBounds: (
    bounds: [[number, number], [number, number]],
    options?: object,
  ) => void;
}

/**
 * MapLibre GL JS lifecycle hook.
 *
 * Manages map creation, load state, and cleanup.
 * Provides helper methods for common operations.
 */
export function useMapLibre({
  container,
  center = [10.0, 48.0],
  zoom = 13,
  style = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
}: UseMapLibreOptions): UseMapLibreReturn {
  const mapRef = useRef<MapInstance | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    if (!container.current) return;

    // Dynamic import of maplibre-gl to avoid hard dependency at module level
    let cancelled = false;

    async function initMap() {
      try {
        const maplibregl = await import("maplibre-gl");
        if (cancelled || !container.current) return;

        const map = new maplibregl.Map({
          container: container.current,
          style,
          center,
          zoom,
        }) as unknown as MapInstance;

        mapRef.current = map;

        map.on("load", () => {
          if (!cancelled) {
            setIsLoaded(true);
          }
        });
      } catch {
        // maplibre-gl not installed — leave map as null
        // This allows the component to render a fallback
        console.warn(
          "maplibre-gl not available. Install with: npm install maplibre-gl",
        );
      }
    }

    initMap();

    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      setIsLoaded(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [container.current]);

  const addSource = useCallback((id: string, data: object) => {
    const map = mapRef.current;
    if (!map) return;

    if (map.getSource(id)) {
      map.removeSource(id);
    }

    map.addSource(id, {
      type: "geojson",
      data,
    });
  }, []);

  const addLayer = useCallback((layer: object, beforeId?: string) => {
    const map = mapRef.current;
    if (!map) return;

    const layerDef = layer as { id?: string };
    if (layerDef.id && map.getLayer(layerDef.id)) {
      map.removeLayer(layerDef.id);
    }

    map.addLayer(layer, beforeId);
  }, []);

  const fitBounds = useCallback(
    (bounds: [[number, number], [number, number]], options?: object) => {
      const map = mapRef.current;
      if (!map) return;
      map.fitBounds(bounds, { padding: 40, ...options });
    },
    [],
  );

  return {
    mapRef: mapRef as React.RefObject<MapInstance | null>,
    isLoaded,
    addSource,
    addLayer,
    fitBounds,
  };
}

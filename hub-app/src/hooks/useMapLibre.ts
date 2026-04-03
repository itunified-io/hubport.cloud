import { useCallback, useEffect, useRef, useState } from "react";
import "maplibre-gl/dist/maplibre-gl.css";

/**
 * MapLibre GL JS map instance lifecycle hook.
 *
 * Manages map creation, load state, and cleanup.
 * Uses a callback ref pattern so the map initializes correctly
 * even when the container element appears after initial render.
 */

export interface MapInstance {
  addSource: (id: string, source: object) => void;
  addLayer: (layer: object, beforeId?: string) => void;
  removeLayer: (id: string) => void;
  removeSource: (id: string) => void;
  getSource: (id: string) => object | undefined;
  getLayer: (id: string) => object | undefined;
  setStyle: (style: string | object) => void;
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
  queryRenderedFeatures: (
    geometry?: [[number, number], [number, number]],
    options?: { layers?: string[] },
  ) => Array<{ properties: Record<string, unknown>; [key: string]: unknown }>;
  dragPan: { enable: () => void; disable: () => void };
  setPaintProperty: (layerId: string, name: string, value: unknown) => void;
}

/** Available map styles */
export const MAP_STYLES = {
  street: {
    label: "Street",
    url: "https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json",
  },
  satellite: {
    label: "Satellite",
    url: {
      version: 8,
      sources: {
        "esri-satellite": {
          type: "raster",
          tiles: [
            "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
          ],
          tileSize: 256,
          attribution: "Esri, Maxar, Earthstar Geographics",
          maxzoom: 19,
        },
      },
      layers: [{ id: "esri-satellite", type: "raster", source: "esri-satellite" }],
    } as object,
  },
  osm: {
    label: "OSM",
    url: {
      version: 8,
      sources: {
        "osm-raster": {
          type: "raster",
          tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
          tileSize: 256,
          attribution: "&copy; OpenStreetMap contributors",
          maxzoom: 19,
        },
      },
      layers: [{ id: "osm-raster", type: "raster", source: "osm-raster" }],
    } as object,
  },
} as const;

export type MapStyleKey = keyof typeof MAP_STYLES;

export interface UseMapLibreOptions {
  /** Container element ref */
  container: React.RefObject<HTMLDivElement | null>;
  /** Initial center [lng, lat] */
  center?: [number, number];
  /** Initial zoom level */
  zoom?: number;
  /** Map style URL or key */
  style?: string;
}

export interface UseMapLibreReturn {
  /** Map instance ref — null until loaded */
  mapRef: React.RefObject<MapInstance | null>;
  /** Whether the map has finished initial load */
  isLoaded: boolean;
  /** Current style key */
  activeStyle: MapStyleKey;
  /** Add a GeoJSON source to the map */
  addSource: (id: string, data: object) => void;
  /** Add a layer to the map */
  addLayer: (layer: object, beforeId?: string) => void;
  /** Fit the map to bounds */
  fitBounds: (
    bounds: [[number, number], [number, number]],
    options?: object,
  ) => void;
  /** Switch map style */
  changeStyle: (key: MapStyleKey) => void;
  /** Register a callback that fires when the style is loaded (after changeStyle) */
  onStyleReady: (cb: () => void) => void;
  /** The maplibre-gl module — use for creating Markers etc. */
  maplibreModule: React.RefObject<any | null>;
}

export function useMapLibre({
  container,
  center = [10.0, 48.0],
  zoom = 13,
  style = MAP_STYLES.street.url,
}: UseMapLibreOptions): UseMapLibreReturn {
  const mapRef = useRef<MapInstance | null>(null);
  const maplibreModuleRef = useRef<any | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [activeStyle, setActiveStyle] = useState<MapStyleKey>("street");
  const styleReadyCb = useRef<(() => void) | null>(null);
  const styleChangeGenRef = useRef(0);
  const initAttempted = useRef(false);

  // Poll for container availability — handles late-appearing containers
  // (e.g., when parent component shows loading state first)
  useEffect(() => {
    if (mapRef.current) return; // Already initialized
    if (initAttempted.current && !container.current) return;

    let cancelled = false;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    async function initMap(el: HTMLElement) {
      initAttempted.current = true;
      try {
        const maplibregl = await import("maplibre-gl");
        if (cancelled) return;
        maplibreModuleRef.current = maplibregl;

        const map = new maplibregl.Map({
          container: el,
          style,
          center,
          zoom,
        }) as unknown as MapInstance;

        mapRef.current = map;

        map.on("load", () => {
          if (!cancelled) setIsLoaded(true);
        });
      } catch {
        console.warn("maplibre-gl not available");
      }
    }

    // Try immediately
    if (container.current) {
      initMap(container.current);
    } else {
      // Poll every 100ms for container to appear (max 5s)
      let attempts = 0;
      pollTimer = setInterval(() => {
        attempts++;
        if (container.current) {
          clearInterval(pollTimer!);
          pollTimer = null;
          initMap(container.current);
        } else if (attempts > 50) {
          clearInterval(pollTimer!);
          pollTimer = null;
        }
      }, 100);
    }

    return () => {
      cancelled = true;
      if (pollTimer) clearInterval(pollTimer);
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      setIsLoaded(false);
      initAttempted.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addSource = useCallback((id: string, data: object) => {
    const map = mapRef.current;
    if (!map) return;
    if (map.getSource(id)) {
      // Remove all layers using this source before removing the source
      const style = (map as any).getStyle?.();
      if (style?.layers) {
        for (const layer of style.layers) {
          if ((layer as any).source === id && map.getLayer(layer.id)) {
            map.removeLayer(layer.id);
          }
        }
      }
      map.removeSource(id);
    }
    map.addSource(id, { type: "geojson", data });
  }, []);

  const addLayer = useCallback((layer: object, beforeId?: string) => {
    const map = mapRef.current;
    if (!map) return;
    const layerDef = layer as { id?: string };
    if (layerDef.id && map.getLayer(layerDef.id)) map.removeLayer(layerDef.id);
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

  const changeStyle = useCallback((key: MapStyleKey) => {
    const map = mapRef.current;
    if (!map) return;
    setActiveStyle(key);
    map.setStyle(MAP_STYLES[key].url);

    // Increment generation — stale handlers from previous changeStyle calls become no-ops
    const gen = ++styleChangeGenRef.current;

    const handler = () => {
      if (styleChangeGenRef.current !== gen) return; // stale — skip
      if (styleReadyCb.current) styleReadyCb.current();
    };
    map.on("styledata", handler);
    setTimeout(() => map.off("styledata", handler), 5_000);
  }, []);

  const onStyleReady = useCallback((cb: () => void) => {
    styleReadyCb.current = cb;
  }, []);

  return {
    mapRef: mapRef as React.RefObject<MapInstance | null>,
    isLoaded,
    activeStyle,
    addSource,
    addLayer,
    fitBounds,
    changeStyle,
    onStyleReady,
    maplibreModule: maplibreModuleRef,
  };
}

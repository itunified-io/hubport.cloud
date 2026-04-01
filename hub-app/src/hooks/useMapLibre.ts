import { useCallback, useEffect, useRef, useState } from "react";

/**
 * MapLibre GL JS map instance lifecycle hook.
 *
 * Manages map creation, load state, and cleanup.
 * Provides helper methods for common operations including style switching.
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
  /** Switch map style — layers must be re-added after switch via onStyleReady */
  changeStyle: (key: MapStyleKey) => void;
  /** Register a callback that fires when the style is loaded (after changeStyle) */
  onStyleReady: (cb: () => void) => void;
}

export function useMapLibre({
  container,
  center = [10.0, 48.0],
  zoom = 13,
  style = MAP_STYLES.street.url,
}: UseMapLibreOptions): UseMapLibreReturn {
  const mapRef = useRef<MapInstance | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [activeStyle, setActiveStyle] = useState<MapStyleKey>("street");
  const styleReadyCb = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!container.current) return;

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

  const changeStyle = useCallback((key: MapStyleKey) => {
    const map = mapRef.current;
    if (!map) return;

    const styleDef = MAP_STYLES[key];
    setActiveStyle(key);

    map.setStyle(styleDef.url);

    // After style loads, notify consumers to re-add layers
    const handler = () => {
      if (styleReadyCb.current) {
        styleReadyCb.current();
      }
    };
    // "styledata" fires when style is fully loaded
    map.on("styledata", handler);
    // Clean up after one fire
    setTimeout(() => map.off("styledata", handler), 5000);
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
  };
}

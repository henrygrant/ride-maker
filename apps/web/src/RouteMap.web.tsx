import type { RouteDocument } from "@ride-maker/domain";
import { useEffect, useState } from "react";
import * as maplibregl from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { css, html } from "react-strict-dom";

const ROUTE_SOURCE_ID = "active-route";
const ROUTE_CASING_LAYER_ID = "active-route-casing";
const ROUTE_LAYER_ID = "active-route-line";
const CONTROL_SOURCE_ID = "route-controls";
const CONTROL_CIRCLE_LAYER_ID = "route-control-circles";
const CONTROL_LABEL_LAYER_ID = "route-control-labels";

maplibregl.setWorkerUrl(workerUrl);

const styles = css.create({
  map: {
    height: "100%",
    width: "100%",
  },
  error: {
    backgroundColor: "rgba(23, 33, 29, 0.92)",
    borderRadius: 8,
    color: "#ffffff",
    fontFamily: "ui-sans-serif, system-ui, sans-serif",
    fontSize: 13,
    left: 16,
    maxWidth: 360,
    padding: 12,
    position: "absolute",
    top: 16,
    zIndex: 1,
  },
});

type RouteMapProps = {
  document: RouteDocument | null;
  isPlanning: boolean;
  onCloseLoop: () => void;
  onMapClick: (coordinate: {
    latitude: number;
    longitude: number;
  }) => void;
};

export function RouteMap({
  document,
  isPlanning,
  onCloseLoop,
  onMapClick,
}: RouteMapProps) {
  const [mapError, setMapError] = useState<string | null>(null);
  const [map, setMap] = useState<maplibregl.Map | null>(null);

  useEffect(() => {
    const nextMap = new maplibregl.Map({
      container: "ride-map",
      // Keyless OSM vector tiles for development. We can self-host this stack later.
      style: "https://tiles.openfreemap.org/styles/liberty",
      center: [-73.9866, 40.7306],
      zoom: 11,
      attributionControl: false,
    });

    nextMap.addControl(new maplibregl.NavigationControl(), "top-right");
    nextMap.addControl(
      new maplibregl.AttributionControl({ compact: true }),
      "bottom-right",
    );

    nextMap.once("error", (event) => {
      setMapError(`The basemap could not be loaded: ${event.error.message}`);
    });
    setMap(nextMap);

    return () => {
      setMap(null);
      nextMap.remove();
    };
  }, []);

  useEffect(() => {
    if (map === null) return;

    const drawRoute = () => updateRoute(map, document);
    if (map.isStyleLoaded()) {
      drawRoute();
      return;
    }

    map.once("load", drawRoute);
    return () => {
      map.off("load", drawRoute);
    };
  }, [document, map]);

  useEffect(() => {
    if (map === null) return;

    const canvas = map.getCanvas();
    canvas.style.cursor = isPlanning ? "crosshair" : "";
    if (!isPlanning) return;

    const handleClick = (event: maplibregl.MapMouseEvent) => {
      const clickedControls = map.queryRenderedFeatures(event.point, {
        layers:
          map.getLayer(CONTROL_CIRCLE_LAYER_ID) === undefined
            ? []
            : [CONTROL_CIRCLE_LAYER_ID],
      });
      const clickedFirstPoint = clickedControls.some(
        (feature) => feature.properties?.index === 0,
      );

      if (clickedFirstPoint && (document?.controlPoints.length ?? 0) >= 2) {
        onCloseLoop();
        return;
      }

      onMapClick({
        latitude: event.lngLat.lat,
        longitude: event.lngLat.lng,
      });
    };

    map.on("click", handleClick);
    return () => {
      canvas.style.cursor = "";
      map.off("click", handleClick);
    };
  }, [document, isPlanning, map, onCloseLoop, onMapClick]);

  return (
    <>
      {mapError === null ? null : (
        <html.div role="alert" style={styles.error}>
          {mapError}
        </html.div>
      )}
      <html.div id="ride-map" style={styles.map} />
    </>
  );
}

function updateRoute(map: maplibregl.Map, document: RouteDocument | null) {
  if (document === null) {
    removeRoute(map);
    return;
  }

  const featureCollection = {
    type: "FeatureCollection" as const,
    features: document.segments
      .filter((segment) => segment.points.length >= 2)
      .map((segment) => ({
        type: "Feature" as const,
        properties: {},
        geometry: {
          type: "LineString" as const,
          coordinates: segment.points.map((point) => [
            point.longitude,
            point.latitude,
          ]),
        },
      })),
  };
  const controlCollection = {
    type: "FeatureCollection" as const,
    features: document.controlPoints.map((point, index) => ({
      type: "Feature" as const,
      properties: { id: point.id, index, label: String(index + 1) },
      geometry: {
        type: "Point" as const,
        coordinates: [point.longitude, point.latitude],
      },
    })),
  };

  const existingSource = map.getSource(ROUTE_SOURCE_ID);
  if (existingSource === undefined) {
    map.addSource(ROUTE_SOURCE_ID, {
      type: "geojson",
      data: featureCollection,
    });
    map.addLayer({
      id: ROUTE_CASING_LAYER_ID,
      type: "line",
      source: ROUTE_SOURCE_ID,
      paint: {
        "line-color": "#ffffff",
        "line-opacity": 0.9,
        "line-width": 8,
      },
      layout: { "line-cap": "round", "line-join": "round" },
    });
    map.addLayer({
      id: ROUTE_LAYER_ID,
      type: "line",
      source: ROUTE_SOURCE_ID,
      paint: { "line-color": "#e94f37", "line-width": 5 },
      layout: { "line-cap": "round", "line-join": "round" },
    });
  } else {
    (existingSource as maplibregl.GeoJSONSource).setData(featureCollection);
  }

  const existingControlSource = map.getSource(CONTROL_SOURCE_ID);
  if (existingControlSource === undefined) {
    map.addSource(CONTROL_SOURCE_ID, {
      type: "geojson",
      data: controlCollection,
    });
    map.addLayer({
      id: CONTROL_CIRCLE_LAYER_ID,
      type: "circle",
      source: CONTROL_SOURCE_ID,
      paint: {
        "circle-color": "#ffffff",
        "circle-radius": 11,
        "circle-stroke-color": "#17211d",
        "circle-stroke-width": 2,
      },
    });
    map.addLayer({
      id: CONTROL_LABEL_LAYER_ID,
      type: "symbol",
      source: CONTROL_SOURCE_ID,
      layout: {
        "text-field": ["get", "label"],
        "text-size": 12,
      },
      paint: { "text-color": "#17211d" },
    });
  } else {
    (existingControlSource as maplibregl.GeoJSONSource).setData(controlCollection);
  }

  const bounds = new maplibregl.LngLatBounds();
  for (const segment of document.segments) {
    for (const point of segment.points) {
      bounds.extend([point.longitude, point.latitude]);
    }
  }
  if (!bounds.isEmpty()) {
    map.fitBounds(bounds, { padding: 64, duration: 0, maxZoom: 15 });
  }
}

function removeRoute(map: maplibregl.Map) {
  if (map.getLayer(CONTROL_LABEL_LAYER_ID) !== undefined) {
    map.removeLayer(CONTROL_LABEL_LAYER_ID);
  }
  if (map.getLayer(CONTROL_CIRCLE_LAYER_ID) !== undefined) {
    map.removeLayer(CONTROL_CIRCLE_LAYER_ID);
  }
  if (map.getLayer(ROUTE_LAYER_ID) !== undefined) {
    map.removeLayer(ROUTE_LAYER_ID);
  }
  if (map.getLayer(ROUTE_CASING_LAYER_ID) !== undefined) {
    map.removeLayer(ROUTE_CASING_LAYER_ID);
  }
  if (map.getSource(ROUTE_SOURCE_ID) !== undefined) {
    map.removeSource(ROUTE_SOURCE_ID);
  }
  if (map.getSource(CONTROL_SOURCE_ID) !== undefined) {
    map.removeSource(CONTROL_SOURCE_ID);
  }
}

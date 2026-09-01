"use client";

import { useEffect, useRef } from "react";
import Map from "ol/Map";
import View from "ol/View";
import TileLayer from "ol/layer/Tile";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import OSM from "ol/source/OSM";
import GeoJSON from "ol/format/GeoJSON";
import Attribution from "ol/control/Attribution";
import { Fill, Stroke, Style } from "ol/style";
import { fromLonLat } from "ol/proj";
import "ol/ol.css";

const ACCENT = "hsl(265 70% 55%)";

/** Minimal OpenLayers map that highlights the country itself.
 *
 *  Deliberately inert: no zoom buttons, no scroll-wheel zoom, no drag. The
 *  card is a glance surface inside a scrolling dashboard, and a pannable map
 *  there would swallow page scroll on touch.
 *
 *  Tiles are plain OSM desaturated in CSS rather than a styled basemap —
 *  Carto's light_nolabels stamps "API KEY REQUIRED" across unkeyed tiles, and
 *  OSM needs no key. Borders come from world-atlas' 110m TopoJSON, loaded on
 *  demand so ~100KB of geometry stays out of the homepage bundle.
 */
export function CountryMap({
  lat,
  lng,
  name,
  ccn3,
  areaKm2,
  className = "h-[110px]",
}: {
  lat: number;
  lng: number;
  name?: string | null;
  /** Numeric ISO 3166-1 — how world-atlas keys its features. */
  ccn3?: string | null;
  areaKm2?: number | null;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const explicit = document.documentElement.getAttribute("data-theme");
    const isDark = explicit
      ? explicit === "dark"
      : !!window.matchMedia?.("(prefers-color-scheme: dark)").matches;

    const shapes = new VectorSource();
    const map = new Map({
      target: el,
      layers: [
        new TileLayer({ source: new OSM() }),
        new VectorLayer({
          source: shapes,
          style: new Style({
            fill: new Fill({ color: "hsl(265 70% 55% / 0.42)" }),
            stroke: new Stroke({ color: ACCENT, width: 1.5 }),
          }),
        }),
      ],
      // Fallback framing until the polygon loads (and if it never does).
      view: new View({
        center: fromLonLat([lng, lat]),
        zoom: zoomForArea(areaKm2),
        enableRotation: false,
      }),
      controls: [new Attribution({ collapsible: true, collapsed: true })],
      interactions: [],
    });

    // Filter the tile layer's own element so the highlight and the attribution
    // keep their real colors.
    const tiles = el.querySelector<HTMLElement>(".ol-layer");
    if (tiles) {
      tiles.style.filter = isDark
        ? "grayscale(1) invert(0.92) contrast(0.8) brightness(1.05)"
        : "grayscale(1) contrast(0.8) brightness(1.07)";
    }

    let cancelled = false;
    (async () => {
      if (!ccn3) return;
      try {
        const [{ feature }, topo] = await Promise.all([
          import("topojson-client"),
          import("world-atlas/countries-110m.json"),
        ]);
        if (cancelled) return;

        // world-atlas ids are numeric ISO codes; ccn3 is zero-padded ("392").
        const topology = (topo.default ?? topo) as Parameters<typeof feature>[0];
        const collection = feature(
          topology,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (topology as any).objects.countries
        ) as unknown as { features: { id?: string | number }[] };

        const target = String(Number(ccn3));
        const match = collection.features.find(
          (f) => String(Number(f.id)) === target
        );
        if (!match) return;

        const geometries = new GeoJSON().readFeatures(match, {
          dataProjection: "EPSG:4326",
          featureProjection: "EPSG:3857",
        });
        shapes.addFeatures(geometries);

        // Fit to the country's real extent — exact framing beats an
        // area-derived guess, and guarantees the whole country is in shot.
        const extent = shapes.getExtent();
        if (extent && Number.isFinite(extent[0])) {
          map.getView().fit(extent, {
            size: map.getSize(),
            // Generous padding is what shows where the country sits in the
            // world rather than filling the frame with it.
            padding: [22, 22, 22, 22],
            maxZoom: 6,
          });
        }
      } catch {
        // Keep the centered fallback view.
      }
    })();

    return () => {
      cancelled = true;
      map.setTarget(undefined);
    };
  }, [lat, lng, ccn3, areaKm2]);

  return (
    <div
      ref={ref}
      className={`w-full ${className} bg-secondary country-map`}
      role="img"
      aria-label={name ? `Map showing the location of ${name}` : "Country location map"}
    />
  );
}

/** Fallback zoom when there is no polygon: derived from land area, because one
 *  fixed level cannot frame both Russia (~170° of longitude) and Monaco. */
function zoomForArea(areaKm2?: number | null): number {
  if (!areaKm2) return 3;
  if (areaKm2 >= 3_000_000) return 1.5;
  if (areaKm2 >= 1_000_000) return 2.2;
  if (areaKm2 >= 300_000) return 2.7;
  if (areaKm2 >= 50_000) return 3.4;
  if (areaKm2 >= 5_000) return 4.2;
  return 5;
}

"use client";

import { useEffect, useRef } from "react";
import Map from "ol/Map";
import View from "ol/View";
import TileLayer from "ol/layer/Tile";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import OSM from "ol/source/OSM";
import Feature from "ol/Feature";
import Point from "ol/geom/Point";
import { fromLonLat } from "ol/proj";
import { Circle as CircleStyle, Fill, Stroke, Style } from "ol/style";
import Attribution from "ol/control/Attribution";
import "ol/ol.css";

/** Minimal OpenLayers map centered on a country's centroid.
 *
 *  Deliberately inert: no zoom buttons, no scroll-wheel zoom, no drag. The
 *  card is a glance surface inside a scrolling dashboard, and a pannable map
 *  there would swallow page scroll on touch.
 *
 *  Tiles are plain OSM, desaturated in CSS rather than fetched from a styled
 *  basemap — Carto's light_nolabels now stamps "API KEY REQUIRED" across
 *  unkeyed tiles, and OSM needs no key. The grayscale filter is what makes it
 *  minimal; dark mode inverts it so the landmass stays lighter than the page.
 */
/** Zoom that fits the country and still shows where it sits in the world.
 *
 *  Derived from land area, because one fixed zoom cannot frame both Russia
 *  (~170° of longitude) and Monaco. The buckets are tuned against a ~300px
 *  wide card: at zoom z that card spans roughly 360 / 2^z degrees, so Russia
 *  needs ~1.5 and a mid-size country like Japan reads well around 2.6 — close
 *  enough to see the neighbouring landmasses for context.
 */
function zoomForArea(areaKm2?: number | null): number {
  if (!areaKm2) return 3;
  if (areaKm2 >= 3_000_000) return 1.5;
  if (areaKm2 >= 1_000_000) return 2.2;
  if (areaKm2 >= 300_000) return 2.7;
  if (areaKm2 >= 50_000) return 3.4;
  if (areaKm2 >= 5_000) return 4.2;
  return 5;
}

export function CountryMap({
  lat,
  lng,
  name,
  // Area rather than a zoom level: zoomForArea lives in this "use client"
  // module, so a server component cannot call it — it can only pass data in.
  areaKm2,
  className = "h-[110px]",
}: {
  lat: number;
  lng: number;
  name?: string | null;
  areaKm2?: number | null;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const zoom = zoomForArea(areaKm2);

  useEffect(() => {
    if (!ref.current) return;

    const dark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
    const explicit = document.documentElement.getAttribute("data-theme");
    const isDark = explicit ? explicit === "dark" : dark;

    const marker = new Feature(new Point(fromLonLat([lng, lat])));
    marker.setStyle(
      new Style({
        image: new CircleStyle({
          radius: 5,
          fill: new Fill({ color: "hsl(265, 70%, 55%)" }),
          stroke: new Stroke({ color: isDark ? "#0b0b0d" : "#ffffff", width: 2 }),
        }),
      })
    );

    const map = new Map({
      target: ref.current,
      layers: [
        new TileLayer({ source: new OSM() }),
        new VectorLayer({ source: new VectorSource({ features: [marker] }) }),
      ],
      view: new View({ center: fromLonLat([lng, lat]), zoom, enableRotation: false }),
      controls: [new Attribution({ collapsible: true, collapsed: true })],
      interactions: [],
    });

    // The filter lives on the tile layer's own element so the marker and the
    // attribution control keep their real colors.
    const tiles = ref.current.querySelector<HTMLElement>(".ol-layer");
    if (tiles) {
      tiles.style.filter = isDark
        ? "grayscale(1) invert(0.92) contrast(0.85) brightness(1.05)"
        : "grayscale(1) contrast(0.82) brightness(1.06)";
    }

    return () => map.setTarget(undefined);
  }, [lat, lng, zoom]);

  return (
    <div
      ref={ref}
      className={`w-full ${className} bg-secondary [&_.ol-layer]:transition-none`}
      role="img"
      aria-label={name ? `Map showing the location of ${name}` : "Country location map"}
    />
  );
}

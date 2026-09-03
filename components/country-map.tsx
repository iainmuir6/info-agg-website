"use client";

import { useEffect, useRef } from "react";
import Map from "ol/Map";
import View from "ol/View";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import GeoJSON from "ol/format/GeoJSON";
import { Fill, Stroke, Style, Text } from "ol/style";
import { fromLonLat } from "ol/proj";
import type { FeatureLike } from "ol/Feature";
import "ol/ol.css";

const ACCENT = "hsl(265 70% 55%)";

/** Minimal vector map that highlights one country.
 *
 *  There are no raster tiles. OSM's standard tiles label places in each
 *  country's own language (Japan rendered as 日本, its neighbours in Chinese
 *  and Korean), and every keyless English-labelled basemap now wants an API
 *  key — Carto's light_nolabels stamps "API KEY REQUIRED" over unkeyed tiles.
 *  Drawing straight from world-atlas' 110m TopoJSON solves both at once: its
 *  `properties.name` is already English, it is public-domain Natural Earth so
 *  no attribution control is needed, and it is the same fetch that supplies
 *  the highlight — so the whole map costs one lazy import and no tile traffic.
 *
 *  Deliberately inert: no zoom buttons, no wheel zoom, no drag. The card is a
 *  glance surface inside a scrolling page, and a pannable map would swallow
 *  page scroll on touch.
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

    const land = isDark ? "hsl(220 6% 26%)" : "hsl(220 10% 90%)";
    const border = isDark ? "hsl(220 6% 38%)" : "hsl(220 8% 78%)";
    const label = isDark ? "hsl(220 8% 68%)" : "hsl(220 8% 45%)";
    const halo = isDark ? "hsl(220 10% 16%)" : "hsl(0 0% 100%)";

    const world = new VectorSource();
    const target = ccn3 ? String(Number(ccn3)) : null;

    const worldStyle = (f: FeatureLike) => {
      const isTarget = target != null && String(Number(f.getId())) === target;
      return new Style({
        fill: new Fill({ color: isTarget ? "hsl(265 70% 55% / 0.45)" : land }),
        stroke: new Stroke({
          color: isTarget ? ACCENT : border,
          width: isTarget ? 0.75 : 0.4,
        }),
        // declutter drops labels that collide, so small countries simply go
        // unlabelled instead of overprinting their neighbours.
        text: new Text({
          text: String(f.get("name") ?? ""),
          font: "600 8px ui-monospace, SFMono-Regular, Menlo, monospace",
          fill: new Fill({ color: isTarget ? ACCENT : label }),
          stroke: new Stroke({ color: halo, width: 2.5 }),
          overflow: false,
        }),
      });
    };

    const map = new Map({
      target: el,
      layers: [new VectorLayer({ source: world, style: worldStyle, declutter: true })],
      // Fallback framing until the geometry loads (and if it never does).
      view: new View({
        center: fromLonLat([lng, lat]),
        zoom: zoomForArea(areaKm2),
        enableRotation: false,
      }),
      controls: [],
      interactions: [],
    });

    // The card body is a CSS grid that animates from 0fr, and on mobile a card
    // can mount while collapsed — so the container is routinely 0x0 at mount,
    // which made OpenLayers warn and render nothing. Watch for the first real
    // size, then tell the map to measure again and re-fit.
    let fitExtent: number[] | null = null;
    const refit = () => {
      if (!el.clientWidth || !el.clientHeight) return;
      map.updateSize();
      if (fitExtent) {
        map.getView().fit(fitExtent, {
          size: map.getSize(),
          padding: [24, 24, 24, 24],
          maxZoom: 6,
        });
      }
    };
    const observer = new ResizeObserver(refit);
    observer.observe(el);

    let cancelled = false;
    (async () => {
      try {
        const [{ feature }, topo] = await Promise.all([
          import("topojson-client"),
          import("world-atlas/countries-110m.json"),
        ]);
        if (cancelled) return;

        // The bundled JSON's inferred type does not line up with
        // topojson-client's Topology, so go through unknown deliberately.
        const topology = (topo.default ?? topo) as unknown as Parameters<typeof feature>[0];
        const collection = feature(
          topology,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (topology as any).objects.countries
        ) as unknown as object;

        unwrapAntimeridian(collection);

        const features = new GeoJSON().readFeatures(collection, {
          dataProjection: "EPSG:4326",
          featureProjection: "EPSG:3857",
        });
        world.addFeatures(features);

        if (!target) return;
        const match = features.find((f) => String(Number(f.getId())) === target);
        const extent = match?.getGeometry()?.getExtent();
        if (!extent || !Number.isFinite(extent[0])) return;

        // Fit to the country's real extent — exact framing beats an
        // area-derived guess, and guarantees the whole country is in shot.
        // Remembered so refit() can reapply it once the card has a size.
        fitExtent = extent;
        refit();
      } catch {
        // Keep the centered fallback view.
      }
    })();

    return () => {
      cancelled = true;
      observer.disconnect();
      map.setTarget(undefined);
    };
  }, [lat, lng, ccn3, areaKm2]);

  return (
    <div
      ref={ref}
      className={`w-full ${className} country-map`}
      role="img"
      aria-label={name ? `Map showing the location of ${name}` : "Country location map"}
    />
  );
}

/** Reconcile rings and parts that cross the antimeridian.
 *
 *  world-atlas' 110m geometry for Russia and Fiji crosses ±180°, and a
 *  vertex-by-vertex EPSG:4326 → EPSG:3857 transform cannot know that. Two
 *  things go wrong, and both were visible on the card:
 *
 *  1. A ring stepping from +179° to -179° reprojects as a sweep back across
 *     the entire world, so the polygon closes as a slab spanning every
 *     longitude. That is the grey band that ran across Iceland's map — the
 *     smear is Russia's, and it would cross any country framed at a latitude
 *     it passes through.
 *  2. A MultiPolygon with parts on both sides of the line has an extent of the
 *     full -180…180 whatever its real width, so fit() frames the whole planet.
 *     Russia and Fiji both did; Fiji is 2.9° wide and was drawn at world zoom.
 *
 *  So: carry longitudes past ±180 within each ring, then shift whole parts by
 *  multiples of 360° onto the same side as the largest one. Chukotka ends up
 *  at 180–190°E, off the right-hand edge of the world, which is where it
 *  belongs. Countries that do not cross the line are left byte-identical.
 */
function unwrapAntimeridian(collection: object): void {
  const unwrapRing = (ring: number[][]) => {
    for (let i = 1; i < ring.length; i++) {
      const step = ring[i][0] - ring[i - 1][0];
      // Compare against the already-corrected previous vertex, so the shift
      // accumulates along the ring instead of being reapplied at every step.
      if (step > 180) ring[i][0] -= 360;
      else if (step < -180) ring[i][0] += 360;
    }
  };
  const meanLon = (ring: number[][]) =>
    ring.reduce((sum, pt) => sum + pt[0], 0) / ring.length;

  const { features } = collection as {
    features?: { geometry?: { type?: string; coordinates?: unknown } }[];
  };

  for (const f of features ?? []) {
    const geom = f.geometry;
    if (geom?.type === "Polygon") {
      (geom.coordinates as number[][][]).forEach(unwrapRing);
      continue;
    }
    if (geom?.type !== "MultiPolygon") continue;

    const parts = geom.coordinates as number[][][][];
    for (const part of parts) part.forEach(unwrapRing);

    // The largest part is the mainland, so it decides which side of the line
    // the country sits on; outlying islands move to join it.
    const anchor = parts.reduce((a, b) => (b[0].length > a[0].length ? b : a));
    const ref = meanLon(anchor[0]);
    for (const part of parts) {
      const shift = Math.round((ref - meanLon(part[0])) / 360) * 360;
      if (shift) for (const ring of part) for (const pt of ring) pt[0] += shift;
    }
  }
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

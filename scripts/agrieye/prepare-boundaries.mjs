// One-time preparation of lightweight AgriEye boundary files.
//
// Input: the datameet/maps shapefiles (Survey of India based states, Census
// 2011 districts; CC BY 2.5 India). Download them into a working directory:
//   States/Admin2.{shp,dbf}
//   Districts/Census_2011/2011_Dist.{shp,dbf}
// Usage:
//   node scripts/agrieye/prepare-boundaries.mjs <download-dir>
// Output (committed, loaded lazily by the browser):
//   public/agrieye/geo/india-states.json      simplified state outlines
//   public/agrieye/geo/districts/<state>.json simplified districts per state
//   public/agrieye/geo/index.json             state catalog, centroids, bboxes
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readDbf, readPolygonShp } from './shapefile.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = path.join(ROOT, 'public', 'agrieye', 'geo');
const source = process.argv[2];
if (!source) {
  console.error('Usage: node scripts/agrieye/prepare-boundaries.mjs <dir>');
  process.exit(1);
}

const STATE_TOLERANCE = 0.02; // degrees (~2 km) — national overview
const DISTRICT_TOLERANCE = 0.006; // degrees (~650 m) — district outlines
const MIN_RING_AREA = 0.0008; // square degrees; drops specks and slivers
const round = (value) => Math.round(value * 1000) / 1000;

const slug = (name) =>
  name
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const STATE_NAMES = {
  'Andaman & Nicobar': 'Andaman and Nicobar Islands',
  'Jammu & Kashmir': 'Jammu and Kashmir',
};

function ringArea(ring) {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
    sum += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  return sum / 2;
}

function perpendicular(point, start, end) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  if (dx === 0 && dy === 0)
    return Math.hypot(point[0] - start[0], point[1] - start[1]);
  const t = Math.max(
    0,
    Math.min(
      1,
      ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) /
        (dx * dx + dy * dy),
    ),
  );
  return Math.hypot(point[0] - start[0] - t * dx, point[1] - start[1] - t * dy);
}

function simplify(points, tolerance) {
  if (points.length < 4) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    let index = -1;
    let max = tolerance;
    for (let i = first + 1; i < last; i += 1) {
      const distance = perpendicular(points[i], points[first], points[last]);
      if (distance > max) {
        max = distance;
        index = i;
      }
    }
    if (index !== -1) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

function cleanRing(ring, tolerance) {
  const simplified = simplify(ring, tolerance).map(([x, y]) => [
    round(x),
    round(y),
  ]);
  const deduped = simplified.filter(
    (point, i) =>
      i === 0 ||
      point[0] !== simplified[i - 1][0] ||
      point[1] !== simplified[i - 1][1],
  );
  if (deduped.length < 4) return null;
  const first = deduped[0];
  const last = deduped.at(-1);
  if (first[0] !== last[0] || first[1] !== last[1]) deduped.push([...first]);
  return deduped;
}

function pointInRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}

/** Shapefile rings: clockwise outer, counter-clockwise holes. */
function toPolygons(rings, tolerance) {
  const polygons = [];
  for (const ring of rings) {
    const area = ringArea(ring);
    const cleaned = cleanRing(ring, tolerance);
    if (!cleaned) continue;
    if (area < 0) {
      // Signed area < 0 with this formula means clockwise: an outer ring.
      if (Math.abs(area) < MIN_RING_AREA) continue;
      polygons.push([cleaned]);
    } else if (Math.abs(area) >= MIN_RING_AREA) {
      const owner = polygons.find((polygon) =>
        pointInRing(cleaned[0], polygon[0]),
      );
      if (owner) owner.push(cleaned);
    }
  }
  return polygons;
}

function bboxOf(polygons) {
  let [w, s, e, n] = [180, 90, -180, -90];
  for (const polygon of polygons)
    for (const [x, y] of polygon[0]) {
      w = Math.min(w, x);
      e = Math.max(e, x);
      s = Math.min(s, y);
      n = Math.max(n, y);
    }
  return [round(w), round(s), round(e), round(n)];
}

/** Area-weighted centroid of the largest part, nudged inside if needed. */
function labelPoint(polygons) {
  const largest = polygons.reduce((best, polygon) =>
    Math.abs(ringArea(polygon[0])) > Math.abs(ringArea(best[0]))
      ? polygon
      : best,
  );
  const ring = largest[0];
  let cx = 0;
  let cy = 0;
  let area = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const cross = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    area += cross;
    cx += (ring[j][0] + ring[i][0]) * cross;
    cy += (ring[j][1] + ring[i][1]) * cross;
  }
  let point = [cx / (3 * area), cy / (3 * area)];
  if (!pointInRing(point, ring)) {
    // Scan a coarse grid for the interior point nearest the centroid.
    const [w, s, e, n] = bboxOf([largest]);
    let best = null;
    for (let x = w; x <= e; x += (e - w) / 24)
      for (let y = s; y <= n; y += (n - s) / 24)
        if (pointInRing([x, y], ring)) {
          const d = Math.hypot(x - point[0], y - point[1]);
          if (!best || d < best.d) best = { x, y, d };
        }
    if (best) point = [best.x, best.y];
  }
  return [round(point[0]), round(point[1])];
}

/** Approximate area in km² (equirectangular per ring, fine at district scale). */
function areaKm2(polygons) {
  let total = 0;
  for (const polygon of polygons)
    polygon.forEach((ring, index) => {
      const lat = (ring[0][1] * Math.PI) / 180;
      const a = Math.abs(ringArea(ring)) * 111.32 * 111.32 * Math.cos(lat);
      total += index === 0 ? a : -a;
    });
  return Math.round(total);
}

function feature(id, properties, polygons) {
  return {
    type: 'Feature',
    id,
    properties,
    geometry:
      polygons.length === 1
        ? { type: 'Polygon', coordinates: polygons[0] }
        : { type: 'MultiPolygon', coordinates: polygons },
  };
}

const read = (name) => readFileSync(path.join(source, name));
const stateRecords = readDbf(read('States_Admin2.dbf'));
const stateShapes = readPolygonShp(read('States_Admin2.shp'));
const districtRecords = readDbf(read('Districts_Census_2011_2011_Dist.dbf'));
const districtShapes = readPolygonShp(read('Districts_Census_2011_2011_Dist.shp'));

const states = stateRecords.map((record, index) => {
  const name = STATE_NAMES[record.ST_NM] || record.ST_NM;
  const raw = stateShapes[index];
  const polygons = toPolygons(raw, STATE_TOLERANCE);
  // Precise (lightly simplified) outlines are kept only for district lookup.
  const lookup = toPolygons(raw, 0.002);
  return { id: slug(name), name, raw, polygons, lookup };
});

const districtsByState = new Map(states.map((state) => [state.id, []]));
for (const [index, record] of districtRecords.entries()) {
  const polygons = toPolygons(districtShapes[index], DISTRICT_TOLERANCE);
  if (!polygons.length) continue;
  const centroid = labelPoint(polygons);
  // Census 2011 predates Telangana and Ladakh; assign by location, not label.
  const state =
    states.find((candidate) =>
      candidate.lookup.some((polygon) => pointInRing(centroid, polygon[0])),
    ) ||
    states.find(
      (candidate) =>
        candidate.name === (STATE_NAMES[record.ST_NM] || record.ST_NM),
    );
  if (!state) {
    console.warn('No state for district', record.DISTRICT);
    continue;
  }
  districtsByState.get(state.id).push({
    polygons,
    properties: {
      id: `${state.id}--${slug(record.DISTRICT)}`,
      name: record.DISTRICT,
      state: state.name,
      stateId: state.id,
      censusCode: record.censuscode,
      centroid,
      bbox: bboxOf(polygons),
      areaKm2: areaKm2(polygons),
    },
  });
}

mkdirSync(path.join(OUT, 'districts'), { recursive: true });
const provenance = {
  source: 'datameet/maps (github.com/datameet/maps)',
  license: 'CC BY 2.5 India',
  notes:
    'States: Survey of India based outlines. Districts: Census of India 2011 ' +
    'boundaries (districts created after 2011 are not separated). ' +
    'Geometry simplified for display; not suitable for cadastral use.',
};

const index = [];
const stateFeatures = [];
for (const state of states) {
  if (!state.polygons.length) continue;
  const districts = districtsByState.get(state.id);
  const properties = {
    id: state.id,
    name: state.name,
    centroid: labelPoint(state.polygons),
    bbox: bboxOf(state.polygons),
    areaKm2: areaKm2(state.polygons),
    districtCount: districts.length,
  };
  stateFeatures.push(feature(state.id, properties, state.polygons));
  index.push({
    ...properties,
    districtsFile: districts.length ? `districts/${state.id}.json` : null,
    districts: districts.map(({ properties: d }) => ({
      id: d.id,
      name: d.name,
      centroid: d.centroid,
      bbox: d.bbox,
    })),
  });
  if (districts.length) {
    districts.sort((a, b) =>
      a.properties.name.localeCompare(b.properties.name),
    );
    writeFileSync(
      path.join(OUT, 'districts', `${state.id}.json`),
      JSON.stringify({
        type: 'FeatureCollection',
        provenance,
        features: districts.map((d) =>
          feature(d.properties.id, d.properties, d.polygons),
        ),
      }),
    );
  }
}

index.sort((a, b) => a.name.localeCompare(b.name));
writeFileSync(
  path.join(OUT, 'india-states.json'),
  JSON.stringify({
    type: 'FeatureCollection',
    provenance,
    features: stateFeatures,
  }),
);
writeFileSync(
  path.join(OUT, 'index.json'),
  JSON.stringify({ provenance, states: index }),
);
console.log(
  `Wrote ${stateFeatures.length} states and ${index.reduce((n, s) => n + s.districtCount, 0)} districts to ${OUT}`,
);

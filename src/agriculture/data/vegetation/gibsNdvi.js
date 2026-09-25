import { cached, fetchWithTimeout, mapLimit } from '../http.js';
import { geometryContains } from '../geography/boundaries.js';

// NDVI per district from NASA GIBS, keyless and CORS-enabled.
// GIBS serves MODIS Terra 8-day NDVI as a palette PNG whose colours map
// one-to-one onto NDVI intervals (published colormap). AgriEye requests a
// small image per district, decodes each pixel back to NDVI through that
// colormap, and averages the pixels that fall inside the district.
const LAYER = 'MODIS_Terra_NDVI_8Day';
const WMS = 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi';
const DOMAIN = `https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/1.0.0/${LAYER}/default/250m/all/all.xml`;
const COLORMAP = 'https://gibs.earthdata.nasa.gov/colormaps/v1.3/MODIS_NDVI.xml';
const COMPARISON_DAYS = 16;
const SAMPLE_PIXELS = 40;
const TTL_MS = 6 * 60 * 60_000;

/** Latest date in a GIBS DescribeDomains time domain ("a/b/P1D,c/d/P1D"). */
export function latestDomainDate(xml) {
  const domain = /<Domain>([^<]+)<\/Domain>/.exec(String(xml))?.[1];
  if (!domain) return null;
  const ends = domain
    .split(',')
    .map((range) => range.split('/')[1] || range.split('/')[0])
    .filter((date) => /^\d{4}-\d{2}-\d{2}/.test(date))
    .sort();
  return ends.at(-1)?.slice(0, 10) || null;
}

export function shiftDate(isoDate, days) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Parse the GIBS NDVI colormap into a colour → NDVI lookup. */
export function parseNdviColormap(xml) {
  const lookup = new Map();
  const pattern = /<ColorMapEntry\s+([^>]*?)\/>/g;
  for (const [, attributes] of String(xml).matchAll(pattern)) {
    const attr = (name) => new RegExp(`${name}="([^"]*)"`).exec(attributes)?.[1];
    const rgb = attr('rgb')?.split(',').map(Number);
    const range = /\[?\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)/.exec(attr('value') || '');
    if (!rgb || rgb.length !== 3 || !range) continue;
    const excluded = attr('nodata') === 'true' || attr('transparent') === 'true';
    const value = (Number(range[1]) + Number(range[2])) / 2;
    lookup.set((rgb[0] << 16) | (rgb[1] << 8) | rgb[2], excluded ? null : value);
  }
  if (!lookup.size) throw new Error('NDVI colormap could not be parsed');
  return lookup;
}

function decodeColor(lookup, entries, r, g, b) {
  const key = (r << 16) | (g << 8) | b;
  if (lookup.has(key)) return lookup.get(key);
  // Tolerate tiny colour shifts from image decoding.
  let best = null;
  let bestDistance = 13;
  for (const [color, value] of entries) {
    const dr = ((color >> 16) & 255) - r;
    const dg = ((color >> 8) & 255) - g;
    const db = (color & 255) - b;
    const distance = dr * dr + dg * dg + db * db;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = value;
    }
  }
  return best;
}

/**
 * Average NDVI of pixels inside `geometry` from RGBA pixels covering `bbox`.
 * @returns {{ndvi:number|null, validPixels:number, insidePixels:number}}
 */
export function averageNdvi(rgba, width, height, bbox, geometry, lookup) {
  const entries = [...lookup.entries()];
  const [west, south, east, north] = bbox;
  let total = 0;
  let valid = 0;
  let inside = 0;
  for (let y = 0; y < height; y += 1) {
    const lat = north - ((y + 0.5) / height) * (north - south);
    for (let x = 0; x < width; x += 1) {
      const lon = west + ((x + 0.5) / width) * (east - west);
      if (!geometryContains(geometry, [lon, lat])) continue;
      inside += 1;
      const offset = (y * width + x) * 4;
      if (rgba[offset + 3] < 128) continue;
      const value = decodeColor(lookup, entries, rgba[offset], rgba[offset + 1], rgba[offset + 2]);
      if (value == null) continue;
      total += value;
      valid += 1;
    }
  }
  return {
    ndvi: valid ? Math.round((total / valid) * 1000) / 1000 : null,
    validPixels: valid,
    insidePixels: inside,
  };
}

export function sampleSize(bbox) {
  const [west, south, east, north] = bbox;
  const aspect = (east - west) / Math.max(1e-6, north - south);
  return aspect >= 1
    ? [SAMPLE_PIXELS, Math.max(8, Math.round(SAMPLE_PIXELS / aspect))]
    : [Math.max(8, Math.round(SAMPLE_PIXELS * aspect)), SAMPLE_PIXELS];
}

async function decodePng(blob) {
  const bitmap = await createImageBitmap(blob);
  const canvas =
    typeof OffscreenCanvas === 'function'
      ? new OffscreenCanvas(bitmap.width, bitmap.height)
      : Object.assign(document.createElement('canvas'), {
          width: bitmap.width,
          height: bitmap.height,
        });
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(bitmap, 0, 0);
  bitmap.close?.();
  return context.getImageData(0, 0, canvas.width, canvas.height).data;
}

/** WMS GetMap URL for a small NDVI image covering `bbox` on `date`. */
export function ndviRequestUrl(bbox, date) {
  const [width, height] = sampleSize(bbox);
  const params = new URLSearchParams({
    SERVICE: 'WMS',
    REQUEST: 'GetMap',
    VERSION: '1.3.0',
    LAYERS: LAYER,
    CRS: 'EPSG:4326',
    // WMS 1.3.0 EPSG:4326 axis order is latitude, longitude.
    BBOX: [bbox[1], bbox[0], bbox[3], bbox[2]].join(','),
    WIDTH: String(width),
    HEIGHT: String(height),
    FORMAT: 'image/png',
    TIME: date,
  });
  return { url: `${WMS}?${params}`, width, height };
}

async function sampleDistrict(feature, date, lookup, signal) {
  const bbox = feature.properties.bbox;
  const { url, width, height } = ndviRequestUrl(bbox, date);
  let response;
  try {
    response = await fetchWithTimeout(url, { signal, timeoutMs: 30_000 });
  } catch (error) {
    // One retry: GIBS occasionally drops a tile request under load.
    if (signal?.aborted) throw error;
    response = await fetchWithTimeout(url, { signal, timeoutMs: 30_000 });
  }
  const rgba = await decodePng(await response.blob());
  return averageNdvi(rgba, width, height, bbox, feature.geometry, lookup);
}

let colormapPromise;
function loadColormap(signal) {
  colormapPromise ||= fetchWithTimeout(COLORMAP, { signal, timeoutMs: 40_000 })
    .then((response) => response.text())
    .then(parseNdviColormap)
    .catch((error) => {
      colormapPromise = null;
      throw error;
    });
  return colormapPromise;
}

/** Latest GIBS NDVI composite date (cached for the session). */
export async function fetchLatestNdviDate({ signal } = {}) {
  const { value } = await cached('gibs-ndvi-date', TTL_MS, async () => {
    const xml = await (await fetchWithTimeout(DOMAIN, { signal, timeoutMs: 40_000 })).text();
    const date = latestDomainDate(xml);
    if (!date) throw new Error('GIBS time domain unavailable');
    return date;
  });
  return value;
}

/**
 * Sample NDVI now and ~16 days earlier for every district feature.
 * @returns {Promise<{date:string, previousDate:string, results:Array<object|null>, stale:boolean, fetchedAt:number}>}
 */
export async function fetchDistrictNdvi(features, { signal, cacheKey, bypassCache = false } = {}) {
  const date = await fetchLatestNdviDate({ signal });
  const previousDate = shiftDate(date, -COMPARISON_DAYS);
  const outcome = await cached(`gibs-ndvi:${cacheKey}:${date}`, bypassCache ? 0 : TTL_MS, async () => {
    const lookup = await loadColormap(signal);
    const jobs = features.flatMap((feature) => [
      [feature, date],
      [feature, previousDate],
    ]);
    const settled = await mapLimit(jobs, 6, ([feature, when]) =>
      sampleDistrict(feature, when, lookup, signal),
    );
    if (settled.every((entry) => !entry.ok)) throw settled[0].error;
    return features.map((_, index) => {
      const now = settled[index * 2];
      const before = settled[index * 2 + 1];
      if (!now.ok || now.value.ndvi == null) return null;
      const previous = before.ok ? before.value.ndvi : null;
      return {
        ndvi: now.value.ndvi,
        previousNdvi: previous,
        change: previous == null ? null : Math.round((now.value.ndvi - previous) * 1000) / 1000,
        validFraction: now.value.insidePixels
          ? Math.round((now.value.validPixels / now.value.insidePixels) * 100) / 100
          : 0,
      };
    });
  });
  return { date, previousDate, results: outcome.value, stale: outcome.stale, fetchedAt: outcome.fetchedAt };
}

/** Imagery overlay parameters for the same NDVI product. */
export const NDVI_WMS = Object.freeze({
  url: WMS,
  layer: LAYER,
  domainUrl: DOMAIN,
  colormapUrl: COLORMAP,
  comparisonDays: COMPARISON_DAYS,
});

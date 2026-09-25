// Capture AgriEye's demo dataset: a dated, archived snapshot of the same open
// data the live app reads (Open-Meteo + NASA GIBS MODIS NDVI) for one state.
// Demo mode shows this snapshot labelled "DEMO DATA" with its capture date,
// so the stage demo works offline without presenting invented values.
//
// Usage: node scripts/agrieye/capture-demo-snapshot.mjs [state-id]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import {
  buildOpenMeteoUrl,
  normalizeOpenMeteoLocation,
} from '../../src/agriculture/data/weather/openMeteo.js';
import {
  NDVI_WMS,
  averageNdvi,
  latestDomainDate,
  ndviRequestUrl,
  parseNdviColormap,
  shiftDate,
} from '../../src/agriculture/data/vegetation/gibsNdvi.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const stateId = process.argv[2] || 'tamil-nadu';
const districts = JSON.parse(
  readFileSync(path.join(ROOT, 'public/agrieye/geo/districts', `${stateId}.json`), 'utf8'),
);

async function get(url, as = 'json') {
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return as === 'json' ? response.json() : as === 'text' ? response.text() : Buffer.from(await response.arrayBuffer());
}

const features = districts.features;
const payload = await get(buildOpenMeteoUrl(features.map((f) => f.properties.centroid)));
const meteo = (Array.isArray(payload) ? payload : [payload]).map(normalizeOpenMeteoLocation);

const date = latestDomainDate(await get(NDVI_WMS.domainUrl, 'text'));
const previousDate = shiftDate(date, -NDVI_WMS.comparisonDays);
const lookup = parseNdviColormap(await get(NDVI_WMS.colormapUrl, 'text'));

async function sample(feature, when) {
  const { url, width, height } = ndviRequestUrl(feature.properties.bbox, when);
  const png = await get(url, 'buffer');
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.width !== width || info.height !== height) throw new Error('Unexpected NDVI image size');
  return averageNdvi(data, width, height, feature.properties.bbox, feature.geometry, lookup);
}

const regions = [];
for (const [i, feature] of features.entries()) {
  const [now, before] = await Promise.all([sample(feature, date), sample(feature, previousDate)]);
  const ndvi =
    now.ndvi == null
      ? null
      : {
          ndvi: now.ndvi,
          previousNdvi: before.ndvi,
          change: before.ndvi == null ? null : Math.round((now.ndvi - before.ndvi) * 1000) / 1000,
          validFraction: now.insidePixels ? Math.round((now.validPixels / now.insidePixels) * 100) / 100 : 0,
        };
  regions.push({ id: feature.properties.id, name: feature.properties.name, meteo: meteo[i], ndvi });
  process.stdout.write(`${feature.properties.name}: NDVI ${ndvi?.ndvi ?? '—'}\n`);
}

const out = path.join(ROOT, 'public/agrieye/demo');
mkdirSync(out, { recursive: true });
writeFileSync(
  path.join(out, `${stateId}.json`),
  JSON.stringify({
    kind: 'agrieye-demo-snapshot',
    stateId,
    capturedAt: new Date().toISOString(),
    weatherObservedAt: meteo.find(Boolean)?.observedAt || null,
    ndviDate: date,
    ndviPreviousDate: previousDate,
    sources: ['Open-Meteo (CC BY 4.0)', 'NASA GIBS MODIS_Terra_NDVI_8Day'],
    note: 'Archived snapshot of open data for offline demonstrations. Not current conditions.',
    regions,
  }),
);
console.log(`Wrote demo snapshot for ${regions.length} districts (NDVI ${date}).`);

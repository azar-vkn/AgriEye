import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assessWaterStress, assessCropStress, assessHeatRisk, assessSolarOpportunity, assessAgriculturalRisk } from './analysis/index.js';
import { normalizeOpenMeteoLocation, buildOpenMeteoUrl } from './data/weather/openMeteo.js';
import { averageNdvi, latestDomainDate, parseNdviColormap, shiftDate } from './data/vegetation/gibsNdvi.js';
import { relativeSoilMoisture, soilMoistureBand } from './data/soil/soilMoisture.js';
import { createBoundaryService, geometryContains } from './data/geography/boundaries.js';
import { createAgriDataStore } from './data/store.js';
import { buildPlaceIndex, findPlaces, searchPlaces } from './ai/places.js';
import { createAgricultureAgent } from './ai/agricultureAgent.js';
import { STATUS } from './model/provenance.js';

const PUBLIC = new URL('../../public/', import.meta.url);
const readPublic = (path) => JSON.parse(readFileSync(new URL(path.replace(/^\//, ''), PUBLIC), 'utf8'));

const dry = {
  soil: { relative: 0.1 },
  weather: { maxTemperature3d: 39, rainProbability3d: 10, et0Next7d: 45, rainNext7d: 2, dryDays: 20, rainPast30d: 5 },
  vegetation: { ndvi: 0.25, change: -0.08 },
  solar: { radiationKwh: 6.2 },
};
const wet = {
  soil: { relative: 0.9 },
  weather: { maxTemperature3d: 29, rainProbability3d: 95, et0Next7d: 25, rainNext7d: 60, dryDays: 0, rainPast30d: 180 },
  vegetation: { ndvi: 0.7, change: 0.04 },
  solar: { radiationKwh: 3.5 },
};

test('engines separate dry-hot from wet-cool conditions and explain why', () => {
  const stressed = assessWaterStress(dry);
  assert.equal(stressed.level, 'HIGH');
  assert.ok(stressed.reasons.some((r) => r.startsWith('Low estimated soil moisture')));
  assert.equal(assessWaterStress(wet).level, 'LOW');
  assert.ok(assessWaterStress(wet).mitigating.length > 0);
  const risk = assessAgriculturalRisk(dry);
  assert.equal(risk.level, 'HIGH');
  const total = risk.factors.reduce((sum, f) => sum + f.points, 0);
  assert.ok(Math.abs(total - risk.score) <= 1, 'factor points add up to the score');
});

test('missing inputs reduce coverage or yield INSUFFICIENT, never invented values', () => {
  const partial = assessWaterStress({ weather: { maxTemperature3d: 36 } });
  assert.equal(partial.level, 'INSUFFICIENT');
  assert.equal(partial.score, null);
  const noVegetation = assessCropStress({ ...dry, vegetation: null });
  assert.equal(noVegetation.level, 'INSUFFICIENT');
  assert.match(assessCropStress(dry).headline, /^Possible crop stress/);
  // null must not be treated as zero NDVI change.
  const unchanged = assessWaterStress({ ...wet, vegetation: { ndvi: 0.7, change: null } });
  assert.equal(unchanged.factors.find((f) => f.key === 'ndvi-change').stress, null);
});

test('heat and solar-irrigation thresholds', () => {
  assert.equal(assessHeatRisk({ weather: { maxTemperature3d: 34.9 } }).level, 'LOW');
  assert.equal(assessHeatRisk({ weather: { maxTemperature3d: 35 } }).level, 'MEDIUM');
  assert.equal(assessHeatRisk({ weather: { maxTemperature3d: 38 } }).level, 'HIGH');
  const opportunity = assessSolarOpportunity(dry);
  assert.equal(opportunity.level, 'HIGH');
  assert.match(opportunity.caveat, /does not confirm/);
  assert.equal(assessSolarOpportunity(wet).level, 'LOW');
});

test('soil moisture normalization uses documented bounds', () => {
  assert.equal(relativeSoilMoisture(0.1), 0);
  assert.equal(relativeSoilMoisture(0.36), 1);
  assert.equal(relativeSoilMoisture(null), null);
  assert.equal(soilMoistureBand(0.2), 'LOW');
  assert.equal(soilMoistureBand(0.5), 'MODERATE');
  assert.equal(soilMoistureBand(0.8), 'GOOD');
});

test('Open-Meteo payloads reduce to dated weather, soil and solar inputs', () => {
  const days = Array.from({ length: 37 }, (_, i) => new Date(Date.UTC(2026, 7, 20 + i)).toISOString().slice(0, 10));
  const today = days[30];
  const rain = days.map((_, i) => (i < 20 ? 5 : i < 30 ? 0 : 3));
  const payload = {
    latitude: 8.7,
    longitude: 77.7,
    elevation: 40,
    current: { time: `${today}T10:30`, temperature_2m: 34, soil_moisture_3_to_9cm: 0.2, soil_moisture_9_to_27cm: 0.22, relative_humidity_2m: 50 },
    daily: {
      time: days,
      precipitation_sum: rain,
      temperature_2m_max: days.map(() => 36),
      precipitation_probability_max: days.map((_, i) => (i === 31 ? 80 : 20)),
      shortwave_radiation_sum: days.map(() => 21.6),
      et0_fao_evapotranspiration: days.map(() => 6),
    },
  };
  const result = normalizeOpenMeteoLocation(payload);
  assert.equal(result.observedAt, `${today}T10:30+05:30`);
  assert.equal(result.weather.dryDays, 10);
  assert.equal(result.weather.rainPast30d, 100);
  assert.equal(result.weather.rainNext7d, 21);
  assert.equal(result.weather.rainProbability3d, 80);
  assert.equal(result.weather.et0Next7d, 42);
  assert.equal(result.solar.radiationKwh, 6);
  assert.equal(result.soil.volumetric, 0.21);
  assert.match(buildOpenMeteoUrl([[77.7, 8.7], [78.1, 9.9]]), /latitude=8\.700%2C9\.900/);
});

test('GIBS NDVI pixels decode through the published colormap', () => {
  const xml = `<ColorMaps><ColorMap><Entries>
    <ColorMapEntry rgb="0,26,105" transparent="true" value="[-0.3,-0.2)" nodata="true"/>
    <ColorMapEntry rgb="10,100,10" transparent="false" value="[0.5,0.6)"/>
    <ColorMapEntry rgb="200,180,120" transparent="false" value="[0.1,0.2)"/>
  </Entries></ColorMap></ColorMaps>`;
  const lookup = parseNdviColormap(xml);
  const square = { type: 'Polygon', coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]] };
  // 2×2 image: two healthy, one sparse, one no-data pixel.
  const rgba = new Uint8ClampedArray([10, 100, 10, 255, 10, 100, 10, 255, 200, 180, 120, 255, 0, 26, 105, 255]);
  const result = averageNdvi(rgba, 2, 2, [0, 0, 2, 2], square, lookup);
  assert.equal(result.insidePixels, 4);
  assert.equal(result.validPixels, 3);
  assert.equal(result.ndvi, Math.round(((0.55 * 2 + 0.15) / 3) * 1000) / 1000);
  assert.equal(latestDomainDate('<Domain>2025-01-01/2025-02-01/P1D,2026-02-10/2026-09-23/P1D</Domain>'), '2026-09-23');
  assert.equal(shiftDate('2026-09-23', -16), '2026-09-07');
});

test('point-in-polygon respects holes', () => {
  const withHole = {
    type: 'Polygon',
    coordinates: [
      [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
      [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]],
    ],
  };
  assert.equal(geometryContains(withHole, [2, 2]), true);
  assert.equal(geometryContains(withHole, [5, 5]), false);
});

test('place resolution handles aliases and post-2011 districts', () => {
  const places = buildPlaceIndex(readPublic('/agrieye/geo/index.json'));
  const [tenkasi] = findPlaces(places, 'soil in Tenkasi');
  assert.equal(tenkasi.place.name, 'Tirunelveli');
  assert.match(tenkasi.note, /formed 2019/);
  assert.equal(findPlaces(places, 'Compare Tirunelveli and Madurai').length, 2);
  assert.equal(findPlaces(places, 'show tuticorin')[0].place.name, 'Thoothukkudi');
  assert.equal(searchPlaces(places, 'tamil')[0].id, 'tamil-nadu');
});

function snapshotStore({ meteoFails = false } = {}) {
  const snapshot = readPublic('/agrieye/demo/tamil-nadu.json');
  const byId = new Map(snapshot.regions.map((r) => [r.id, r]));
  const districts = readPublic('/agrieye/geo/districts/tamil-nadu.json');
  const ids = districts.features.map((f) => f.properties.id);
  return createAgriDataStore({
    boundaries: createBoundaryService({ load: async (url) => readPublic(url) }),
    fetchMeteo: async () => {
      if (meteoFails) throw new Error('offline');
      return { results: ids.map((id) => byId.get(id).meteo), fetchedAt: Date.now(), stale: false };
    },
    fetchNdvi: async () => ({ date: '2026-09-23', previousDate: '2026-09-07', results: ids.map((id) => byId.get(id).ndvi), fetchedAt: Date.now(), stale: false }),
    loadDemo: async () => snapshot,
  });
}

test('a failing source is reported without hiding the sources that worked', async () => {
  const store = snapshotStore({ meteoFails: true });
  await store.init();
  await store.loadState('tamil-nadu');
  const datasets = store.getDatasets('tamil-nadu');
  assert.equal(datasets.weather.status, STATUS.ERROR);
  assert.equal(datasets.vegetation.status, STATUS.AVAILABLE);
  const record = store.getStateRecords('tamil-nadu')[0];
  assert.equal(record.weather, null);
  assert.ok(record.vegetation.ndvi > 0);
  assert.equal(store.getMode(), 'live', 'no silent switch to demo data');
});

test('demo mode labels every data source as demo', async () => {
  const store = snapshotStore();
  await store.init();
  await store.setMode('demo');
  await store.loadState('tamil-nadu');
  const datasets = store.getDatasets('tamil-nadu');
  for (const key of ['weather', 'soil', 'vegetation']) {
    assert.equal(datasets[key].status, STATUS.DEMO);
    assert.equal(datasets[key].freshness, 'demo');
  }
});

test('the agent answers only from loaded data and returns map actions', async () => {
  const store = snapshotStore();
  await store.init();
  let selection = { regionId: null, stateId: null };
  const agent = createAgricultureAgent({
    store,
    getPlaces: () => buildPlaceIndex(store.getIndex()),
    getSelection: () => selection,
  });

  const empty = await agent.ask('Which regions have low soil moisture?');
  assert.equal(empty.status, 'insufficient');

  const water = await agent.ask('Show agricultural water stress in Tamil Nadu');
  assert.deepEqual(water.actions.find((a) => a.type === 'layer'), { type: 'layer', id: 'risk', variant: 'waterStress' });
  const highlighted = water.actions.find((a) => a.type === 'highlight').ids;
  for (const id of highlighted) assert.equal(store.getRecord(id).analysis.waterStress.level, 'HIGH');
  assert.match(water.sources, /Open-Meteo/);

  selection = { regionId: 'tamil-nadu--tirunelveli', stateId: 'tamil-nadu' };
  const why = await agent.ask('Why is this region at risk?');
  const record = store.getRecord('tamil-nadu--tirunelveli');
  assert.match(why.text, new RegExp(`${record.analysis.agriculturalRisk.score}/100`));

  const solar = await agent.ask('Show me areas where high irrigation demand overlaps with high solar potential');
  for (const id of solar.actions.find((a) => a.type === 'highlight').ids)
    assert.equal(store.getRecord(id).analysis.solarOpportunity.level, 'HIGH');
  assert.match(solar.text, /does not confirm existing solar pumps/);

  const compare = await agent.ask('Compare Tirunelveli and Madurai');
  assert.match(compare.text, /Tirunelveli vs Madurai/);
});

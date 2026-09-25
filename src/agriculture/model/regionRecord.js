import { analyzeRegion } from '../analysis/index.js';
import {
  relativeSoilMoisture,
  soilMoistureBand,
} from '../data/soil/soilMoisture.js';
import { ndviBand, ndviTrend } from '../data/vegetation/vegetation.js';

/**
 * Build AgriEye's common region record from whatever inputs are available.
 * Missing inputs stay null — engines then report reduced coverage or
 * INSUFFICIENT rather than guessing.
 *
 * @param {object} args
 * @param {object} args.properties  District boundary properties.
 * @param {object|null} args.meteo  Normalized Open-Meteo location.
 * @param {object|null} args.ndvi   District NDVI sample.
 * @param {{date?:string, previousDate?:string}} [args.ndviDates]
 * @param {Record<string, object>} args.sources  Dataset descriptors in use.
 */
export function buildRegionRecord({ properties, meteo, ndvi, ndviDates = {}, sources }) {
  const [lon, lat] = properties.centroid;
  const relative = relativeSoilMoisture(meteo?.soil?.volumetric);
  const soil =
    meteo?.soil?.volumetric == null
      ? null
      : {
          volumetric: meteo.soil.volumetric,
          relative: relative == null ? null : Math.round(relative * 100) / 100,
          band: soilMoistureBand(relative),
          layers: meteo.soil.layers,
          observedAt: meteo.observedAt,
        };
  const vegetation =
    ndvi?.ndvi == null
      ? null
      : {
          ...ndvi,
          band: ndviBand(ndvi.ndvi),
          trend: ndviTrend(ndvi.change),
          date: ndviDates.date || null,
          previousDate: ndviDates.previousDate || null,
        };
  const weather = meteo?.weather ? { ...meteo.weather, observedAt: meteo.observedAt } : null;
  const solar = meteo?.solar?.radiationKwh == null ? null : { ...meteo.solar };

  const base = {
    id: properties.id,
    name: properties.name,
    level: 'district',
    state: properties.state,
    stateId: properties.stateId,
    location: { lon, lat },
    bbox: properties.bbox,
    areaKm2: properties.areaKm2,
    // Open data used here does not map crop types per district.
    crop: null,
    weather,
    soil,
    vegetation,
    solar,
    grid: meteo?.grid || null,
  };
  const analysis = analyzeRegion(base);
  return Object.freeze({
    ...base,
    // Flat fields of the common agricultural data model.
    vegetationIndex: vegetation?.ndvi ?? null,
    soilMoisture: soil?.relative ?? null,
    temperature: weather?.temperature ?? null,
    rainfall: weather?.rainNext7d ?? null,
    rainfallProbability: weather?.rainProbability3d ?? null,
    solarPotential: solar?.radiationKwh ?? null,
    waterStress: analysis.waterStress.level,
    cropStress: analysis.cropStress.level,
    climateRisk: analysis.climateRisk.level,
    analysis,
    timestamp: new Date().toISOString(),
    dataSources: {
      weather: weather ? sources.weather : null,
      soil: soil ? sources.soil : null,
      vegetation: vegetation ? sources.vegetation : null,
      geography: sources.geography,
    },
  });
}

const avg = (values) => {
  const valid = values.filter(Number.isFinite);
  return valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
};

/** Summarize loaded district records into a state-level overview. */
export function summarizeState(stateEntry, records) {
  const count = (engine, level) =>
    records.filter((record) => record.analysis[engine].level === level).length;
  const withData = records.filter((record) => record.weather || record.vegetation);
  return {
    id: stateEntry.id,
    name: stateEntry.name,
    level: 'state',
    districtCount: records.length,
    districtsWithData: withData.length,
    means: {
      ndvi: avg(records.map((r) => r.vegetation?.ndvi)),
      soil: avg(records.map((r) => r.soil?.relative)),
      temperature: avg(records.map((r) => r.weather?.temperature)),
      maxTemperature3d: avg(records.map((r) => r.weather?.maxTemperature3d)),
      rainProbability3d: avg(records.map((r) => r.weather?.rainProbability3d)),
      rainNext7d: avg(records.map((r) => r.weather?.rainNext7d)),
      radiationKwh: avg(records.map((r) => r.solar?.radiationKwh)),
    },
    counts: {
      riskHigh: count('agriculturalRisk', 'HIGH'),
      riskModerate: count('agriculturalRisk', 'MODERATE'),
      waterHigh: count('waterStress', 'HIGH'),
      cropHigh: count('cropStress', 'HIGH'),
      solarHigh: count('solarOpportunity', 'HIGH'),
      heatHigh: count('heatRisk', 'HIGH'),
    },
  };
}

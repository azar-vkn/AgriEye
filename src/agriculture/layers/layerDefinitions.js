// Thematic layers: each maps a region record to a category, a colour and a
// relative extrusion. Categories come from the analysis engines or the band
// helpers, never from the layer itself, so the map and the panel agree.

export const NO_DATA = Object.freeze({ key: 'NONE', label: 'No data', color: '#5b6166' });

const band = (key, label, color) => ({ key, label, color });

const RISK_BANDS = [
  band('LOW', 'Low', '#3fae74'),
  band('MODERATE', 'Moderate', '#e3b341'),
  band('HIGH', 'High', '#e5533d'),
];
const RISK_VARIANTS = {
  agriculturalRisk: 'Agricultural risk',
  waterStress: 'Water stress',
  cropStress: 'Possible crop stress',
  climateRisk: 'Climate risk',
};

const fromBands = (bands, key) => bands.find((entry) => entry.key === key) || NO_DATA;
const fmt = (value, digits = 0, unit = '') =>
  Number.isFinite(value) ? `${value.toFixed(digits)}${unit}` : '—';

export const LAYERS = [
  {
    id: 'agriculture',
    label: 'Agriculture',
    shortcut: '1',
    icon: 'agriculture',
    description: 'District agricultural regions (Census 2011 boundaries). Select one to analyse it.',
    datasets: ['geography'],
    legend: [band('REGION', 'Agricultural district', '#7fd38b')],
    classify: () => band('REGION', 'Agricultural district', '#7fd38b'),
    extrusion: () => 0.08,
    summary: (r) => (r.vegetation ? `NDVI ${fmt(r.vegetation.ndvi, 2)}` : 'District'),
  },
  {
    id: 'soil',
    label: 'Soil',
    shortcut: '2',
    icon: 'soil',
    description: 'Estimated relative soil moisture, 3–27 cm (land-surface model; regional indicator).',
    datasets: ['soil'],
    legend: [
      band('LOW', 'Low', '#b8652d'),
      band('MODERATE', 'Moderate', '#c9ad55'),
      band('GOOD', 'Good', '#2fa3b8'),
    ],
    classify(record) {
      return fromBands(this.legend, record.soil?.band);
    },
    extrusion: (r) => (r.soil ? 1 - r.soil.relative : null),
    summary: (r) =>
      r.soil ? `${Math.round(r.soil.relative * 100)}% relative · ${r.soil.band}` : 'No soil data',
  },
  {
    id: 'vegetation',
    label: 'Vegetation',
    shortcut: '3',
    icon: 'vegetation',
    description: 'District mean NDVI from the latest MODIS 8-day composite.',
    datasets: ['vegetation'],
    legend: [
      band('LOW', 'Low (< 0.30)', '#a4773c'),
      band('MODERATE', 'Moderate', '#a7bd4c'),
      band('HEALTHY', 'Healthy (≥ 0.50)', '#2f9e55'),
    ],
    classify(record) {
      return fromBands(this.legend, record.vegetation?.band);
    },
    extrusion: (r) => (r.vegetation ? Math.max(0, Math.min(1, r.vegetation.ndvi / 0.8)) : null),
    summary: (r) =>
      r.vegetation
        ? `NDVI ${fmt(r.vegetation.ndvi, 2)} · ${r.vegetation.band}${r.vegetation.trend ? ` · ${r.vegetation.trend}` : ''}`
        : 'No vegetation data',
  },
  {
    id: 'weather',
    label: 'Weather',
    shortcut: '4',
    icon: 'weather',
    description: 'Rain probability over the next 3 days; labels show current temperature and rain chance.',
    datasets: ['weather'],
    legend: [
      band('LOW', 'Rain < 30%', '#46505c'),
      band('MODERATE', 'Rain 30–60%', '#3f7fb5'),
      band('HIGH', 'Rain ≥ 60%', '#5fb8ff'),
    ],
    classify(record) {
      const p = record.weather?.rainProbability3d;
      if (!Number.isFinite(p)) return NO_DATA;
      return this.legend[p >= 60 ? 2 : p >= 30 ? 1 : 0];
    },
    extrusion: (r) =>
      Number.isFinite(r.weather?.rainProbability3d) ? r.weather.rainProbability3d / 100 : null,
    summary: (r) =>
      r.weather
        ? `${fmt(r.weather.temperature, 1, '°C')} · rain ${fmt(r.weather.rainProbability3d, 0, '%')} · ${fmt(r.weather.rainNext7d, 0, ' mm')}/7d`
        : 'No weather data',
    mapLabel: (r) =>
      r.weather
        ? `${r.name}\n${fmt(r.weather.temperature, 0, '°')}  ☂ ${fmt(r.weather.rainProbability3d, 0, '%')}`
        : r.name,
  },
  {
    id: 'solar',
    label: 'Solar',
    shortcut: '5',
    icon: 'solar',
    description: 'Solar-irrigation opportunity: high irrigation demand overlapping strong solar resource.',
    datasets: ['weather', 'soil'],
    legend: [
      band('LOW', 'Low', '#4a4b40'),
      band('MODERATE', 'Moderate', '#c49a2c'),
      band('HIGH', 'High opportunity', '#ffd24a'),
    ],
    classify(record) {
      return fromBands(this.legend, record.analysis.solarOpportunity.level);
    },
    extrusion: (r) => r.analysis.solarOpportunity.irrigationDemand.index,
    summary: (r) => {
      const s = r.analysis.solarOpportunity;
      return `${s.level === 'INSUFFICIENT' ? 'No data' : s.level} · ${fmt(s.solarPotential.kwhPerM2Day, 1, ' kWh/m²/d')} · demand ${s.irrigationDemand.level || '—'}`;
    },
  },
  {
    id: 'heat',
    label: 'Heat',
    shortcut: '6',
    icon: 'heat',
    description: 'Heat risk from the highest forecast daily maximum within 3 days.',
    datasets: ['weather'],
    legend: [
      band('LOW', 'Low (< 35°C)', '#4f6b52'),
      band('MEDIUM', 'Medium (35–38°C)', '#e08a2e'),
      band('HIGH', 'High (≥ 38°C)', '#e5452e'),
    ],
    classify(record) {
      return fromBands(this.legend, record.analysis.heatRisk.level);
    },
    extrusion: (r) => (r.analysis.heatRisk.score == null ? null : r.analysis.heatRisk.score / 100),
    summary: (r) => `${r.analysis.heatRisk.level} · max ${fmt(r.weather?.maxTemperature3d, 1, '°C')}`,
  },
  {
    id: 'risk',
    label: 'Risk',
    shortcut: '7',
    icon: 'risk',
    description:
      'Transparent composite of soil moisture, vegetation condition, temperature and rainfall forecast.',
    datasets: ['weather', 'soil', 'vegetation'],
    variants: RISK_VARIANTS,
    legend: RISK_BANDS,
    classify(record, variant = 'agriculturalRisk') {
      const level = record.analysis[variant]?.level;
      return fromBands(RISK_BANDS, level === 'MEDIUM' ? 'MODERATE' : level);
    },
    extrusion: (r, variant = 'agriculturalRisk') => {
      const score = r.analysis[variant]?.score;
      return score == null ? null : score / 100;
    },
    summary: (r, variant = 'agriculturalRisk') => {
      const a = r.analysis[variant];
      return `${RISK_VARIANTS[variant]}: ${a.level === 'INSUFFICIENT' ? 'insufficient data' : `${a.level} (${a.score})`}`;
    },
  },
];

export const LAYER_BY_ID = Object.freeze(Object.fromEntries(LAYERS.map((layer) => [layer.id, layer])));

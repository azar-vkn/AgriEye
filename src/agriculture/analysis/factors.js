// Shared, explainable building blocks for every AgriEye engine. A factor is
// one measured input turned into a 0..1 stress with the sentence that
// explains it. Engines only choose factors and weights — no hidden scoring.

export const clamp01 = (value) => Math.max(0, Math.min(1, value));

/** Linear 0..1 ramp between `low` (0) and `high` (1); null passes through. */
export function ramp(value, low, high) {
  if (!Number.isFinite(value)) return null;
  return clamp01((value - low) / (high - low));
}

// `null` coerces to 0 in arithmetic; these keep missing inputs missing.
const neg = (value) => (Number.isFinite(value) ? -value : null);
const below = (reference, value) =>
  Number.isFinite(value) ? reference - value : null;

const pct = (value) => `${Math.round(value * 100)}%`;
const signed = (value) =>
  !Number.isFinite(value)
    ? '—'
    : Math.abs(value) < 0.005
      ? '±0.00'
      : `${value > 0 ? '+' : ''}${value.toFixed(2)}`;
const num = (value, digits = 1) =>
  Number.isFinite(value) ? value.toFixed(digits) : '—';

function factor(key, label, stress, weight, { reason, relief, value }) {
  return {
    key,
    label,
    weight,
    stress: stress == null ? null : Math.round(stress * 1000) / 1000,
    value: value ?? null,
    reason: stress != null && stress >= 0.5 ? reason : null,
    relief: stress != null && stress <= 0.25 ? relief : null,
  };
}

/** Water deficit: share of 7-day reference evapotranspiration not met by forecast rain. */
export function waterDeficit(record) {
  const et0 = record.weather?.et0Next7d;
  const rain = record.weather?.rainNext7d;
  if (!Number.isFinite(et0) || !Number.isFinite(rain) || et0 <= 0) return null;
  return clamp01((et0 - rain) / et0);
}

export const FACTORS = {
  soilDryness(record, weight) {
    const relative = record.soil?.relative;
    return factor('soil', 'Soil moisture', relative == null ? null : 1 - relative, weight, {
      value: relative == null ? null : `${pct(relative)} relative (model)`,
      reason: `Low estimated soil moisture (${relative == null ? '—' : pct(relative)} relative, model estimate)`,
      relief: `Adequate estimated soil moisture (${relative == null ? '—' : pct(relative)} relative)`,
    });
  },
  heat(record, weight, low = 30, high = 40) {
    const t = record.weather?.maxTemperature3d;
    return factor('heat', 'Temperature', ramp(t, low, high), weight, {
      value: Number.isFinite(t) ? `${num(t)}°C max (3 days)` : null,
      reason: `Elevated temperature (up to ${num(t)}°C in the next 3 days)`,
      relief: `Moderate temperatures (up to ${num(t)}°C)`,
    });
  },
  rainProbability(record, weight) {
    const p = record.weather?.rainProbability3d;
    return factor(
      'rain-probability',
      'Rain probability',
      Number.isFinite(p) ? 1 - p / 100 : null,
      weight,
      {
        value: Number.isFinite(p) ? `${Math.round(p)}% (next 3 days)` : null,
        reason: `Low rainfall probability (${Math.round(p)}% at most over the next 3 days)`,
        relief: `Rain forecast available (${Math.round(p)}% probability in the next 3 days)`,
      },
    );
  },
  deficit(record, weight) {
    const d = waterDeficit(record);
    const et0 = record.weather?.et0Next7d;
    const rain = record.weather?.rainNext7d;
    return factor('deficit', 'Water balance', d, weight, {
      value: d == null ? null : `ET₀ ${num(et0, 0)} mm vs rain ${num(rain, 0)} mm (7 days)`,
      reason: `Evaporative demand exceeds forecast rain (ET₀ ${num(et0, 0)} mm vs ${num(rain, 0)} mm over 7 days)`,
      relief: `Forecast rain covers most evaporative demand (${num(rain, 0)} mm vs ET₀ ${num(et0, 0)} mm)`,
    });
  },
  vegetationDecline(record, weight) {
    const change = record.vegetation?.change;
    return factor('ndvi-change', 'Vegetation trend', ramp(neg(change), 0, 0.1), weight, {
      value: Number.isFinite(change) ? `${signed(change)} NDVI (16 days)` : null,
      reason: `Declining vegetation (NDVI ${signed(change)} over ~16 days)`,
      relief: `Stable or improving vegetation (NDVI ${signed(change)})`,
    });
  },
  lowVegetation(record, weight, healthy = 0.55, poor = 0.2) {
    const ndvi = record.vegetation?.ndvi;
    return factor('ndvi', 'Vegetation index', ramp(below(healthy, ndvi), 0, healthy - poor), weight, {
      value: Number.isFinite(ndvi) ? `NDVI ${num(ndvi, 2)}` : null,
      reason: `Low vegetation index (district mean NDVI ${num(ndvi, 2)})`,
      relief: `Healthy vegetation cover (district mean NDVI ${num(ndvi, 2)})`,
    });
  },
  vegetationCondition(record, weight) {
    const low = ramp(below(0.55, record.vegetation?.ndvi), 0, 0.35);
    const decline = ramp(neg(record.vegetation?.change), 0, 0.1);
    const stress =
      low == null && decline == null ? null : Math.max(low ?? 0, decline ?? 0);
    const ndvi = record.vegetation?.ndvi;
    const change = record.vegetation?.change;
    return factor('vegetation', 'Vegetation condition', stress, weight, {
      value: Number.isFinite(ndvi) ? `NDVI ${num(ndvi, 2)}${Number.isFinite(change) ? ` (${signed(change)})` : ''}` : null,
      reason:
        (decline ?? 0) > (low ?? 0)
          ? `Declining vegetation (NDVI ${signed(change)} over ~16 days)`
          : `Weak vegetation signal (district mean NDVI ${num(ndvi, 2)})`,
      relief: `Vegetation condition is favourable (NDVI ${num(ndvi, 2)})`,
    });
  },
  rainfallOutlook(record, weight) {
    const p = record.weather?.rainProbability3d;
    const d = waterDeficit(record);
    const parts = [Number.isFinite(p) ? 1 - p / 100 : null, d].filter((v) => v != null);
    const stress = parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : null;
    return factor('rain-outlook', 'Rainfall forecast', stress, weight, {
      value: Number.isFinite(p) ? `${Math.round(p)}% · ${num(record.weather?.rainNext7d, 0)} mm / 7 days` : null,
      reason: `Limited rain in the forecast (${Number.isFinite(p) ? Math.round(p) : '—'}% probability, ${num(record.weather?.rainNext7d, 0)} mm over 7 days)`,
      relief: `Rain forecast available (${Number.isFinite(p) ? Math.round(p) : '—'}% probability, ${num(record.weather?.rainNext7d, 0)} mm over 7 days)`,
    });
  },
  drySpell(record, weight) {
    const days = record.weather?.dryDays;
    return factor('dry-spell', 'Dry spell', ramp(days, 5, 25), weight, {
      value: Number.isFinite(days) ? `${days} days < 1 mm` : null,
      reason: `Dry spell of ${days} consecutive days with under 1 mm rain`,
      relief: `No extended dry spell (${days} dry days)`,
    });
  },
  recentRainfall(record, weight) {
    const mm = record.weather?.rainPast30d;
    return factor('rain-30d', 'Past 30-day rainfall', ramp(below(60, mm), 0, 60), weight, {
      value: Number.isFinite(mm) ? `${num(mm, 0)} mm` : null,
      reason: `Low rainfall over the past 30 days (${num(mm, 0)} mm)`,
      relief: `Meaningful rainfall over the past 30 days (${num(mm, 0)} mm)`,
    });
  },
  rainfallExtremes(record, weight) {
    const mm = record.weather?.rainNext7d;
    const dry = Number.isFinite(mm) ? clamp01(1 - mm / 20) : null;
    const wet = ramp(mm, 100, 250);
    const stress = dry == null ? null : Math.max(dry, wet);
    return factor('rain-extreme', 'Forecast rainfall', stress, weight, {
      value: Number.isFinite(mm) ? `${num(mm, 0)} mm / 7 days` : null,
      reason:
        (wet ?? 0) > (dry ?? 0)
          ? `Heavy rain forecast (${num(mm, 0)} mm over 7 days) — waterlogging risk`
          : `Little rain in the 7-day forecast (${num(mm, 0)} mm)`,
      relief: `Forecast rainfall within a normal range (${num(mm, 0)} mm over 7 days)`,
    });
  },
};

/**
 * Weighted mean of available factor stresses with full provenance.
 * @param {Array<object>} factors
 * @param {{thresholds:[number,number], labels:[string,string,string], minCoverage?:number, required?:string[]}} options
 */
export function combine(factors, { thresholds, labels, minCoverage = 0.6, required = [] }) {
  const total = factors.reduce((sum, f) => sum + f.weight, 0);
  const available = factors.filter((f) => f.stress != null);
  const availableWeight = available.reduce((sum, f) => sum + f.weight, 0);
  const coverage = total ? availableWeight / total : 0;
  const missing = factors.filter((f) => f.stress == null).map((f) => f.label);
  const lacksRequired = required.some(
    (key) => !available.some((f) => f.key === key),
  );
  if (coverage < minCoverage || lacksRequired || !availableWeight) {
    return {
      level: 'INSUFFICIENT',
      score: null,
      coverage: Math.round(coverage * 100) / 100,
      factors,
      reasons: [],
      mitigating: [],
      missing,
    };
  }
  const withPoints = factors.map((f) => ({
    ...f,
    points: f.stress == null ? null : Math.round(((f.stress * f.weight) / availableWeight) * 1000) / 10,
  }));
  const score = Math.round(withPoints.reduce((sum, f) => sum + (f.points ?? 0), 0));
  const level = score >= thresholds[1] ? labels[2] : score >= thresholds[0] ? labels[1] : labels[0];
  return {
    level,
    score,
    coverage: Math.round(coverage * 100) / 100,
    factors: withPoints,
    reasons: withPoints
      .filter((f) => f.reason)
      .sort((a, b) => b.points - a.points)
      .map((f) => f.reason),
    mitigating: withPoints.filter((f) => f.relief).map((f) => f.relief),
    missing,
  };
}

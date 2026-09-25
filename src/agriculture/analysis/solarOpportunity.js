import { clamp01, ramp, waterDeficit } from './factors.js';

const band = (value, moderate, high) =>
  value == null ? null : value >= high ? 'HIGH' : value >= moderate ? 'MODERATE' : 'LOW';

/**
 * Solar-irrigation opportunity: places where irrigation demand and solar
 * resource are both elevated. This indicates suitability only — it does not
 * claim that any solar pump exists or is planned there.
 *
 * Solar potential: mean forecast shortwave radiation, kWh/m²/day
 *   (HIGH ≥ 5.0, MODERATE ≥ 4.0).
 * Irrigation demand index 0..1: 50% water deficit (ET₀ vs forecast rain),
 *   30% soil dryness, 20% heat (HIGH ≥ 0.6, MODERATE ≥ 0.35).
 */
export function assessSolarOpportunity(record) {
  const radiation = record.solar?.radiationKwh;
  const parts = [
    [waterDeficit(record), 0.5],
    [record.soil?.relative == null ? null : 1 - record.soil.relative, 0.3],
    [ramp(record.weather?.maxTemperature3d, 30, 40), 0.2],
  ].filter(([value]) => value != null);
  const weight = parts.reduce((sum, [, w]) => sum + w, 0);
  const demand =
    weight >= 0.5
      ? Math.round(clamp01(parts.reduce((sum, [v, w]) => sum + v * w, 0) / weight) * 100) / 100
      : null;

  const solarLevel = band(radiation, 4, 5);
  const demandLevel = band(demand, 0.35, 0.6);
  let level = 'INSUFFICIENT';
  let statement = 'Not enough data to assess solar-irrigation opportunity.';
  if (solarLevel && demandLevel) {
    if (solarLevel === 'HIGH' && demandLevel === 'HIGH') {
      level = 'HIGH';
      statement = 'High agricultural water demand and favourable solar conditions.';
    } else if (solarLevel !== 'LOW' && demandLevel !== 'LOW') {
      level = 'MODERATE';
      statement = 'Elevated irrigation demand with usable solar resource.';
    } else {
      level = 'LOW';
      statement =
        demandLevel === 'LOW'
          ? 'Irrigation demand is currently low.'
          : 'Solar resource is currently limited (cloud or rain).';
    }
  }
  return {
    level,
    statement,
    solarPotential: { kwhPerM2Day: radiation ?? null, level: solarLevel },
    irrigationDemand: { index: demand, level: demandLevel },
    caveat:
      'Suitability indicator only. It does not confirm existing or planned solar pumps.',
  };
}

import { FACTORS, combine } from './factors.js';

/**
 * Near-term climate risk from dry-spell length, past 30-day rainfall, heat,
 * forecast rainfall extremes (too little or too much) and vegetation
 * condition. Rainfall is not yet compared with a long-term climatology, so
 * it is reported as totals, not anomalies. LOW < 35 ≤ MEDIUM < 60 ≤ HIGH.
 */
export function assessClimateRisk(record) {
  const result = combine(
    [
      FACTORS.drySpell(record, 0.25),
      FACTORS.recentRainfall(record, 0.2),
      FACTORS.heat(record, 0.2, 33, 42),
      FACTORS.rainfallExtremes(record, 0.2),
      FACTORS.vegetationCondition(record, 0.15),
    ],
    { thresholds: [35, 60], labels: ['LOW', 'MEDIUM', 'HIGH'] },
  );
  return {
    ...result,
    note: 'Rainfall is compared with fixed agronomic thresholds, not a long-term average.',
  };
}

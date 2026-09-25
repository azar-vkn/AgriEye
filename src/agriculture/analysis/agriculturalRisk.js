import { FACTORS, combine } from './factors.js';

/**
 * Composite agricultural risk: soil moisture 30%, vegetation condition 25%,
 * temperature 25%, rainfall forecast 20%. Each factor's point contribution
 * is returned so the UI can show exactly why a region scores as it does.
 * LOW < 35 ≤ MODERATE < 60 ≤ HIGH.
 */
export const RISK_WEIGHTS = Object.freeze({
  soil: 0.3,
  vegetation: 0.25,
  heat: 0.25,
  rainfall: 0.2,
});

export function assessAgriculturalRisk(record) {
  return combine(
    [
      FACTORS.soilDryness(record, RISK_WEIGHTS.soil),
      FACTORS.vegetationCondition(record, RISK_WEIGHTS.vegetation),
      FACTORS.heat(record, RISK_WEIGHTS.heat),
      FACTORS.rainfallOutlook(record, RISK_WEIGHTS.rainfall),
    ],
    { thresholds: [35, 60], labels: ['LOW', 'MODERATE', 'HIGH'] },
  );
}

import { FACTORS, combine } from './factors.js';

/**
 * Water stress = low soil moisture + high temperature + low rain probability
 * + evaporative deficit + declining vegetation, each normalized to 0..1.
 * LOW < 35 ≤ MODERATE < 60 ≤ HIGH.
 */
export function assessWaterStress(record) {
  return combine(
    [
      FACTORS.soilDryness(record, 0.35),
      FACTORS.heat(record, 0.2),
      FACTORS.rainProbability(record, 0.2),
      FACTORS.deficit(record, 0.15),
      FACTORS.vegetationDecline(record, 0.1),
    ],
    { thresholds: [35, 60], labels: ['LOW', 'MODERATE', 'HIGH'] },
  );
}

import { FACTORS, combine } from './factors.js';

const HEADLINES = {
  HIGH: 'Possible crop stress',
  MODERATE: 'Early signs of possible crop stress',
  LOW: 'No crop-stress signal in the available data',
  INSUFFICIENT: 'Not enough vegetation data to assess crop stress',
};

/**
 * Possible crop stress from vegetation (level and trend), heat and soil
 * moisture. Remote sensing cannot confirm crop damage on the ground, so the
 * output is always worded as a possibility. Requires a vegetation reading.
 */
export function assessCropStress(record) {
  const result = combine(
    [
      FACTORS.lowVegetation(record, 0.3),
      FACTORS.vegetationDecline(record, 0.3),
      FACTORS.heat(record, 0.2, 32, 40),
      FACTORS.soilDryness(record, 0.2),
    ],
    {
      thresholds: [35, 60],
      labels: ['LOW', 'MODERATE', 'HIGH'],
      required: ['ndvi'],
    },
  );
  return { ...result, headline: HEADLINES[result.level] };
}

import { assessWaterStress } from './waterStress.js';
import { assessCropStress } from './cropStress.js';
import { assessClimateRisk } from './climateRisk.js';
import { assessHeatRisk } from './heatRisk.js';
import { assessSolarOpportunity } from './solarOpportunity.js';
import { assessAgriculturalRisk } from './agriculturalRisk.js';

export {
  assessWaterStress,
  assessCropStress,
  assessClimateRisk,
  assessHeatRisk,
  assessSolarOpportunity,
  assessAgriculturalRisk,
};

/** Run every deterministic engine over one region record. */
export function analyzeRegion(record) {
  return Object.freeze({
    waterStress: assessWaterStress(record),
    cropStress: assessCropStress(record),
    climateRisk: assessClimateRisk(record),
    heatRisk: assessHeatRisk(record),
    solarOpportunity: assessSolarOpportunity(record),
    agriculturalRisk: assessAgriculturalRisk(record),
  });
}

/** Ordinal for sorting/comparing levels across engines. */
export const LEVEL_RANK = Object.freeze({
  INSUFFICIENT: -1,
  LOW: 0,
  MODERATE: 1,
  MEDIUM: 1,
  GOOD: 0,
  HIGH: 2,
});

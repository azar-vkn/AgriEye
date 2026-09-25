// Soil moisture arrives as volumetric water content (m³/m³) from a land
// model. Plant-available water depends on soil texture, which the model grid
// does not resolve, so AgriEye converts it with generic loam-like bounds and
// says so wherever the percentage appears.
export const SOIL_ASSUMPTION = Object.freeze({
  wiltingPoint: 0.1,
  fieldCapacity: 0.36,
  note:
    'Relative moisture assumes generic loam bounds (wilting point 0.10, field capacity 0.36 m³/m³). ' +
    'Clay-rich black soils hold more water; treat the index as a regional indicator, not a field reading.',
});

/** 0..1 share of plant-available water, or null when unknown. */
export function relativeSoilMoisture(volumetric, assumption = SOIL_ASSUMPTION) {
  if (!Number.isFinite(volumetric)) return null;
  const { wiltingPoint, fieldCapacity } = assumption;
  const ratio = (volumetric - wiltingPoint) / (fieldCapacity - wiltingPoint);
  return Math.max(0, Math.min(1, ratio));
}

/** LOW / MODERATE / GOOD band for a 0..1 relative moisture. */
export function soilMoistureBand(relative) {
  if (relative == null) return null;
  if (relative < 0.35) return 'LOW';
  if (relative < 0.6) return 'MODERATE';
  return 'GOOD';
}

/**
 * Adapter slot for ISRO VEDAS / Bhuvan soil-moisture products. Those services
 * require registration and have no keyless browser API, so this adapter
 * reports itself as not configured instead of scraping. A server route that
 * holds credentials can implement `fetchRegions` with the same return shape
 * as the Open-Meteo soil block: { volumetric, observedAt }.
 */
export function createIsroSoilAdapter({ endpoint = null } = {}) {
  return Object.freeze({
    key: 'isro-vedas-soil',
    configured: Boolean(endpoint),
    async fetchRegions() {
      if (!endpoint)
        return { status: 'not-configured', results: [] };
      throw new Error('ISRO VEDAS route is not implemented in this build');
    },
  });
}

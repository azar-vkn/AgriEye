// District-average NDVI mixes cropland, forest, settlements and fallow land,
// so bands describe the area's overall green cover, not a single field.
export function ndviBand(ndvi) {
  if (!Number.isFinite(ndvi)) return null;
  if (ndvi < 0.3) return 'LOW';
  if (ndvi < 0.5) return 'MODERATE';
  return 'HEALTHY';
}

/** "declining" when NDVI fell by at least 0.03 between composites. */
export function ndviTrend(change) {
  if (!Number.isFinite(change)) return null;
  if (change <= -0.03) return 'declining';
  if (change >= 0.03) return 'improving';
  return 'stable';
}

/**
 * Adapter slot for Copernicus Sentinel-2 NDVI (Sentinel Hub Statistical API
 * on the Copernicus Data Space Ecosystem). The API needs OAuth client
 * credentials that must stay server-side, so this build ships the interface
 * and reports it as not configured. A server route can implement
 * `fetchDistrictNdvi` returning the same shape as the GIBS adapter.
 */
export function createCopernicusNdviAdapter({ endpoint = null } = {}) {
  return Object.freeze({
    key: 'copernicus-s2-ndvi',
    configured: Boolean(endpoint),
    async fetchDistrictNdvi() {
      if (!endpoint) return { status: 'not-configured', results: [] };
      throw new Error('Copernicus route is not implemented in this build');
    },
  });
}

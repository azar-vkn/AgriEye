// Every value AgriEye shows is traceable to a dataset descriptor. Freshness
// says how current the data can be; status says what happened when we asked.

/** How current a dataset can be — never inflate this for presentation. */
export const FRESHNESS = Object.freeze({
  LIVE: 'live',
  NEAR_REAL_TIME: 'near-real-time',
  FORECAST: 'forecast',
  PERIODIC: 'periodic',
  STATIC: 'static',
  DEMO: 'demo',
});

export const FRESHNESS_LABEL = Object.freeze({
  live: 'LIVE',
  'near-real-time': 'NEAR-REAL-TIME',
  forecast: 'FORECAST',
  periodic: 'PERIODIC',
  static: 'STATIC',
  demo: 'DEMO DATA',
});

/** What kind of evidence a dataset is. */
export const DATA_TYPE = Object.freeze({
  OBSERVATION: 'observation',
  MODEL: 'model estimate',
  SATELLITE: 'satellite-derived',
  DERIVED: 'derived analysis',
  BOUNDARY: 'reference geography',
  DEMO: 'archived demo snapshot',
});

/** Per-source request lifecycle. */
export const STATUS = Object.freeze({
  IDLE: 'idle',
  LOADING: 'loading',
  AVAILABLE: 'available',
  EMPTY: 'empty',
  ERROR: 'error',
  STALE: 'stale',
  NOT_CONFIGURED: 'not-configured',
  DEMO: 'demo',
});

export const STATUS_LABEL = Object.freeze({
  idle: 'Standby',
  loading: 'Loading',
  available: 'Available',
  empty: 'No data for this area',
  error: 'Temporarily unavailable',
  stale: 'Showing cached data',
  'not-configured': 'Not connected',
  demo: 'Demo dataset',
});

/**
 * Describe one dataset as it was actually obtained.
 * @param {object} fields
 * @returns {Readonly<{key:string,label:string,source:string,sourceUrl:string,
 *   product:string,dataType:string,freshness:string,resolution:string,
 *   status:string,observedAt:string|null,fetchedAt:string|null,
 *   message:string|null,license:string}>}
 */
export function describeDataset({
  key,
  label,
  source,
  sourceUrl = '',
  product = '',
  dataType,
  freshness,
  resolution = '',
  status = STATUS.IDLE,
  observedAt = null,
  fetchedAt = null,
  message = null,
  license = '',
}) {
  if (!key || !source || !freshness)
    throw new TypeError('Datasets need a key, source and freshness');
  return Object.freeze({
    key,
    label: label || key,
    source,
    sourceUrl,
    product,
    dataType,
    freshness,
    resolution,
    status,
    observedAt,
    fetchedAt,
    message,
    license,
  });
}

/** Return a copy of a dataset descriptor with a new request outcome. */
export function withStatus(dataset, status, extra = {}) {
  return describeDataset({ ...dataset, ...extra, status });
}

/** Human age such as "12 min ago" for a timestamp; null when unknown. */
export function describeAge(iso, now = Date.now()) {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return null;
  const minutes = Math.round((now - at) / 60_000);
  if (Math.abs(minutes) < 1) return 'just now';
  if (minutes < 0) {
    const ahead = -minutes;
    if (ahead < 60) return `in ${ahead} min`;
    if (ahead < 48 * 60) return `in ${Math.round(ahead / 60)} h`;
    return `in ${Math.round(ahead / 1440)} days`;
  }
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)} h ago`;
  return `${Math.round(minutes / 1440)} days ago`;
}

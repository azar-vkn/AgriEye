import { DATA_TYPE, FRESHNESS, describeDataset } from '../model/provenance.js';

// The dataset templates AgriEye can draw from. Adapters stamp status and
// timestamps onto these; the UI never invents its own source wording.
export const DATASETS = Object.freeze({
  weather: describeDataset({
    key: 'weather',
    label: 'Weather',
    source: 'Open-Meteo',
    sourceUrl: 'https://open-meteo.com/',
    product:
      'Best-match numerical weather forecast (current conditions, 7-day forecast, past 30 days)',
    dataType: DATA_TYPE.MODEL,
    freshness: FRESHNESS.FORECAST,
    resolution: '~9–25 km model grid, sampled at each district centroid',
    license: 'CC BY 4.0',
  }),
  soil: describeDataset({
    key: 'soil',
    label: 'Soil moisture',
    source: 'Open-Meteo land-surface model',
    sourceUrl: 'https://open-meteo.com/en/docs',
    product:
      'Volumetric soil water 3–27 cm (ECMWF IFS / NOAA GFS land model via Open-Meteo)',
    dataType: DATA_TYPE.MODEL,
    freshness: FRESHNESS.NEAR_REAL_TIME,
    resolution: '~9–25 km model grid, sampled at each district centroid',
    license: 'CC BY 4.0',
  }),
  vegetation: describeDataset({
    key: 'vegetation',
    label: 'Vegetation (NDVI)',
    source: 'NASA MODIS Terra via NASA GIBS',
    sourceUrl: 'https://earthdata.nasa.gov/gibs',
    product: 'MODIS Terra 8-day NDVI composite (MODIS_Terra_NDVI_8Day)',
    dataType: DATA_TYPE.SATELLITE,
    freshness: FRESHNESS.PERIODIC,
    resolution: '250 m product, averaged over a district-wide sample grid',
    license: 'NASA open data (no restrictions; attribution requested)',
  }),
  geography: describeDataset({
    key: 'geography',
    label: 'Boundaries',
    source: 'datameet/maps (Survey of India / Census 2011)',
    sourceUrl: 'https://github.com/datameet/maps',
    product:
      'State outlines and Census 2011 district boundaries, simplified for display',
    dataType: DATA_TYPE.BOUNDARY,
    freshness: FRESHNESS.STATIC,
    resolution: 'Simplified to ~650 m (districts) / ~2 km (states)',
    license: 'CC BY 2.5 India',
  }),
  basemap: describeDataset({
    key: 'basemap',
    label: 'Basemap',
    source: 'Esri World Imagery · OpenStreetMap · Sentinel-2 cloudless',
    sourceUrl: 'https://www.openstreetmap.org/copyright',
    product: 'Reference imagery and map tiles',
    dataType: DATA_TYPE.BOUNDARY,
    freshness: FRESHNESS.STATIC,
    resolution: 'Tiled',
  }),
});

/**
 * Adapters that need credentials or a server route before they can run.
 * They are listed so users can see what is deliberately not in use.
 */
export const PENDING_ADAPTERS = Object.freeze([
  {
    key: 'isro-vedas-soil',
    label: 'ISRO VEDAS soil moisture',
    source: 'ISRO SAC VEDAS',
    sourceUrl: 'https://vedas.sac.gov.in/',
    reason:
      'VEDAS services need registration and do not offer a keyless browser API. ' +
      'The adapter interface is ready; Open-Meteo model soil moisture is used instead.',
  },
  {
    key: 'copernicus-s2-ndvi',
    label: 'Copernicus Sentinel-2 NDVI',
    source: 'Copernicus Data Space Ecosystem',
    sourceUrl: 'https://dataspace.copernicus.eu/',
    reason:
      'Sentinel Hub statistics need OAuth client credentials held server-side. ' +
      'Sentinel-2 cloudless imagery is available as a basemap; NDVI values come from NASA MODIS.',
  },
]);

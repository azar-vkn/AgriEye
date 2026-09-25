import * as Cesium from 'cesium';
import { MapSourceController } from '../../maps/controller.js';
import {
  ESRI_ATTRIBUTION_HTML,
  createEsriImagery,
  createOsmImagery,
} from '../../maps/imagery.js';
import { NDVI_WMS } from '../data/vegetation/gibsNdvi.js';

// AgriEye reuses God's Eye View's map-source controller (provider caching,
// fallback, attribution) with an agriculture-oriented, keyless registry.
// Terrain is left flat on purpose: district extrusions start at sea level and
// a flat globe is the lightest option for modest GPUs.
const S2_ATTRIBUTION =
  '<a href="https://s2maps.eu" target="_blank" rel="noopener">Sentinel-2 cloudless – s2maps.eu by EOX IT Services GmbH</a> ' +
  '(Contains modified Copernicus Sentinel data 2023) · CC BY-NC-SA 4.0';
const OSM_ATTRIBUTION =
  '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a>';

export const BASEMAPS = [
  { id: 'esri-imagery', label: 'Satellite', detail: 'Esri World Imagery' },
  { id: 's2-cloudless', label: 'Sentinel-2', detail: 'Copernicus Sentinel-2 cloudless 2023 mosaic (EOX)' },
  { id: 'osm', label: 'Map', detail: 'OpenStreetMap — roads, villages, water bodies' },
];

function createSentinelCloudless() {
  return new Cesium.UrlTemplateImageryProvider({
    url: 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2023_3857/default/g/{z}/{y}/{x}.jpg',
    maximumLevel: 14,
    credit: new Cesium.Credit(S2_ATTRIBUTION, true),
  });
}

export function createAgriMapRegistry() {
  return {
    defaultId: 'esri-imagery',
    unknownId: 'esri-imagery',
    recoveryId: 'osm',
    state: {},
    sources: [
      {
        descriptor: BASEMAPS[0],
        imagery: createEsriImagery,
        credit: ESRI_ATTRIBUTION_HTML,
        constructionFallback: { id: 'osm', message: 'Esri imagery unavailable; using OpenStreetMap' },
        tileFailureFallback: { id: 'osm', threshold: 3, message: 'Esri imagery tiles failed; using OpenStreetMap' },
      },
      {
        descriptor: BASEMAPS[1],
        imagery: createSentinelCloudless,
        credit: S2_ATTRIBUTION,
        constructionFallback: { id: 'osm', message: 'Sentinel-2 mosaic unavailable; using OpenStreetMap' },
      },
      { descriptor: BASEMAPS[2], imagery: createOsmImagery, credit: OSM_ATTRIBUTION },
    ],
  };
}

/** Darken imagery so thematic colours and the UI read clearly. */
function styledImageryLayer(provider) {
  const layer = new Cesium.ImageryLayer(provider);
  const isMap = provider instanceof Cesium.OpenStreetMapImageryProvider;
  layer.brightness = isMap ? 0.78 : 0.62;
  layer.contrast = isMap ? 1.05 : 1.12;
  layer.saturation = isMap ? 0.55 : 0.78;
  layer.gamma = 1.05;
  return layer;
}

export function createAgriMapController(viewer, { requestRender, onChange, onError } = {}) {
  return new MapSourceController(viewer, {
    registry: createAgriMapRegistry(),
    initialStack: 'esri-imagery',
    requestRender,
    onChange,
    onError,
    createImageryLayer: styledImageryLayer,
  });
}

/** Toggleable NASA GIBS NDVI raster (latest composite) above the basemap. */
export function createNdviOverlay(viewer, { requestRender = () => {} } = {}) {
  let layer = null;
  let date = null;
  return Object.freeze({
    isVisible: () => Boolean(layer?.show),
    show(compositeDate) {
      if (layer && compositeDate === date) {
        layer.show = true;
      } else {
        if (layer) viewer.imageryLayers.remove(layer, true);
        date = compositeDate;
        const provider = new Cesium.WebMapServiceImageryProvider({
          url: NDVI_WMS.url,
          layers: NDVI_WMS.layer,
          parameters: { transparent: true, format: 'image/png', ...(date ? { time: date } : {}) },
          tilingScheme: new Cesium.GeographicTilingScheme(),
          maximumLevel: 9,
          credit: new Cesium.Credit('NDVI imagery: NASA GIBS / MODIS Terra', false),
        });
        layer = viewer.imageryLayers.addImageryProvider(provider);
        layer.alpha = 0.85;
      }
      requestRender('ndvi-overlay');
    },
    hide() {
      if (layer) layer.show = false;
      requestRender('ndvi-overlay');
    },
    destroy() {
      if (layer) viewer.imageryLayers.remove(layer, true);
      layer = null;
    },
  });
}

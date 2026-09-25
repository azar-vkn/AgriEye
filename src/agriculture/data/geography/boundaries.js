import { fetchJson } from '../http.js';

// Boundary files are prepared once by scripts/agrieye/prepare-boundaries.mjs
// and served from public/agrieye/geo. Only the state index and outlines load
// at startup; a state's districts load when that state is opened.
const BASE = '/agrieye/geo/';

/** Lazily load and memoize the committed boundary files. */
export function createBoundaryService({ base = BASE, load = fetchJson } = {}) {
  let indexPromise;
  let statesPromise;
  const districtPromises = new Map();

  const getIndex = () => {
    indexPromise ||= load(`${base}index.json`).catch((error) => {
      indexPromise = null;
      throw error;
    });
    return indexPromise;
  };

  return Object.freeze({
    getIndex,
    getStates() {
      statesPromise ||= load(`${base}india-states.json`).catch((error) => {
        statesPromise = null;
        throw error;
      });
      return statesPromise;
    },
    async getDistricts(stateId) {
      const index = await getIndex();
      const state = index.states.find((entry) => entry.id === stateId);
      if (!state?.districtsFile) return null;
      if (!districtPromises.has(stateId)) {
        districtPromises.set(
          stateId,
          load(`${base}${state.districtsFile}`).catch((error) => {
            districtPromises.delete(stateId);
            throw error;
          }),
        );
      }
      return districtPromises.get(stateId);
    },
  });
}

/** Ray-casting point-in-polygon test for a GeoJSON Polygon/MultiPolygon. */
export function geometryContains(geometry, [lon, lat]) {
  const polygons =
    geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  return polygons.some((rings) => {
    let inside = false;
    rings.forEach((ring, ringIndex) => {
      let inRing = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];
        if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi)
          inRing = !inRing;
      }
      if (ringIndex === 0) inside = inRing;
      else if (inRing) inside = false;
    });
    return inside;
  });
}

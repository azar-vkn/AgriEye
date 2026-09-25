import { DATASETS } from './catalog.js';
import { createBoundaryService } from './geography/boundaries.js';
import { fetchOpenMeteo } from './weather/openMeteo.js';
import { fetchDistrictNdvi } from './vegetation/gibsNdvi.js';
import { fetchJson } from './http.js';
import {
  DATA_TYPE,
  FRESHNESS,
  STATUS,
  describeDataset,
  withStatus,
} from '../model/provenance.js';
import { buildRegionRecord, summarizeState } from '../model/regionRecord.js';

const LIVE_KEYS = ['weather', 'soil', 'vegetation'];

function errorMessage(error) {
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError')
    return 'The source did not respond in time';
  if (error instanceof TypeError) return 'Network request failed';
  return error?.message || String(error);
}

/** Dataset descriptors for an archived demo snapshot — always labelled DEMO. */
function demoDatasets(snapshot) {
  const demo = (key, observedAt) =>
    describeDataset({
      ...DATASETS[key],
      source: `Demo dataset — archived ${DATASETS[key].source} snapshot`,
      dataType: DATA_TYPE.DEMO,
      freshness: FRESHNESS.DEMO,
      status: STATUS.DEMO,
      observedAt,
      fetchedAt: snapshot.capturedAt,
      message: `Captured ${snapshot.capturedAt.slice(0, 10)}. Not current conditions.`,
    });
  return {
    weather: demo('weather', snapshot.weatherObservedAt || snapshot.capturedAt),
    soil: demo('soil', snapshot.weatherObservedAt || snapshot.capturedAt),
    vegetation: demo('vegetation', snapshot.ndviDate || snapshot.capturedAt),
  };
}

/**
 * Owns AgriEye's loaded data: boundaries, per-state source outcomes and the
 * derived region records. Every source fails independently; the store never
 * substitutes demo data for failed live data on its own.
 */
export function createAgriDataStore({
  boundaries = createBoundaryService(),
  fetchMeteo = fetchOpenMeteo,
  fetchNdvi = fetchDistrictNdvi,
  loadDemo = (stateId) => fetchJson(`/agrieye/demo/${stateId}.json`),
} = {}) {
  const listeners = new Set();
  const states = new Map();
  let mode = 'live';
  let index = null;
  let focusedStateId = null;
  let geography = withStatus(DATASETS.geography, STATUS.IDLE);
  const idleDatasets = () =>
    Object.fromEntries(LIVE_KEYS.map((key) => [key, withStatus(DATASETS[key], STATUS.IDLE)]));

  const emit = (type, detail = {}) => {
    for (const listener of [...listeners]) {
      try {
        listener({ type, ...detail });
      } catch (error) {
        console.error('[AgriEye] store listener failed', error);
      }
    }
  };

  function slot(stateId) {
    if (!states.has(stateId)) {
      const entry = index?.states.find((state) => state.id === stateId);
      if (!entry) throw new Error(`Unknown state: ${stateId}`);
      states.set(stateId, {
        entry,
        features: null,
        inputs: { meteo: null, ndvi: null, ndviDates: {} },
        datasets: idleDatasets(),
        records: new Map(),
        summary: null,
        generation: 0,
        loading: null,
      });
    }
    return states.get(stateId);
  }

  function rebuild(state) {
    const { meteo, ndvi, ndviDates } = state.inputs;
    const sources = { ...state.datasets, geography };
    state.records = new Map(
      state.features.map((feature, i) => {
        const record = buildRegionRecord({
          properties: feature.properties,
          meteo: meteo?.[i] ?? null,
          ndvi: ndvi?.[i] ?? null,
          ndviDates,
          sources,
        });
        return [record.id, record];
      }),
    );
    state.summary = summarizeState(state.entry, [...state.records.values()]);
    emit('state-updated', { stateId: state.entry.id });
  }

  function setDatasets(state, patch) {
    state.datasets = { ...state.datasets, ...patch };
    emit('datasets', { stateId: state.entry.id });
  }

  async function loadLive(state, generation, bypassCache = false) {
    const cacheKey = state.entry.id;
    const points = state.features.map((feature) => feature.properties.centroid);
    setDatasets(state, Object.fromEntries(
      LIVE_KEYS.map((key) => [key, withStatus(DATASETS[key], STATUS.LOADING)]),
    ));
    const meteoTask = fetchMeteo(points, { cacheKey, bypassCache })
      .then((outcome) => {
        if (generation !== state.generation) return;
        const any = outcome.results.some(Boolean);
        const status = !any ? STATUS.EMPTY : outcome.stale ? STATUS.STALE : STATUS.AVAILABLE;
        const observedAt = outcome.results.find(Boolean)?.observedAt || null;
        const fetchedAt = new Date(outcome.fetchedAt).toISOString();
        const message = outcome.stale ? 'Live request failed; showing the last cached response.' : null;
        state.inputs.meteo = outcome.results;
        setDatasets(state, {
          weather: withStatus(DATASETS.weather, status, { observedAt, fetchedAt, message }),
          soil: withStatus(DATASETS.soil, status, { observedAt, fetchedAt, message }),
        });
        rebuild(state);
      })
      .catch((error) => {
        if (generation !== state.generation) return;
        const message = errorMessage(error);
        setDatasets(state, {
          weather: withStatus(DATASETS.weather, STATUS.ERROR, { message }),
          soil: withStatus(DATASETS.soil, STATUS.ERROR, { message }),
        });
      });
    const ndviTask = fetchNdvi(state.features, { cacheKey, bypassCache })
      .then((outcome) => {
        if (generation !== state.generation) return;
        const any = outcome.results.some(Boolean);
        state.inputs.ndvi = outcome.results;
        state.inputs.ndviDates = { date: outcome.date, previousDate: outcome.previousDate };
        setDatasets(state, {
          vegetation: withStatus(
            DATASETS.vegetation,
            !any ? STATUS.EMPTY : outcome.stale ? STATUS.STALE : STATUS.AVAILABLE,
            {
              observedAt: outcome.date,
              fetchedAt: new Date(outcome.fetchedAt).toISOString(),
              message: outcome.stale
                ? 'Live request failed; showing the last cached samples.'
                : `8-day composite dated ${outcome.date}; trend compared with ${outcome.previousDate}.`,
            },
          ),
        });
        rebuild(state);
      })
      .catch((error) => {
        if (generation !== state.generation) return;
        setDatasets(state, {
          vegetation: withStatus(DATASETS.vegetation, STATUS.ERROR, { message: errorMessage(error) }),
        });
      });
    await Promise.all([meteoTask, ndviTask]);
  }

  async function loadDemoData(state, generation) {
    try {
      const snapshot = await loadDemo(state.entry.id);
      if (generation !== state.generation) return;
      const byId = new Map(snapshot.regions.map((region) => [region.id, region]));
      state.inputs = {
        meteo: state.features.map((f) => byId.get(f.properties.id)?.meteo ?? null),
        ndvi: state.features.map((f) => byId.get(f.properties.id)?.ndvi ?? null),
        ndviDates: { date: snapshot.ndviDate, previousDate: snapshot.ndviPreviousDate },
      };
      setDatasets(state, demoDatasets(snapshot));
      rebuild(state);
    } catch {
      if (generation !== state.generation) return;
      const message = 'No demo snapshot is bundled for this state.';
      setDatasets(state, Object.fromEntries(
        LIVE_KEYS.map((key) => [key, withStatus(DATASETS[key], STATUS.EMPTY, { message })]),
      ));
    }
  }

  return Object.freeze({
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async init() {
      geography = withStatus(DATASETS.geography, STATUS.LOADING);
      emit('datasets');
      try {
        [index] = await Promise.all([boundaries.getIndex(), boundaries.getStates()]);
        geography = withStatus(DATASETS.geography, STATUS.AVAILABLE, {
          fetchedAt: new Date().toISOString(),
          message: 'Census 2011 districts; districts created after 2011 are shown within their parent district.',
        });
      } catch (error) {
        geography = withStatus(DATASETS.geography, STATUS.ERROR, { message: errorMessage(error) });
        emit('datasets');
        throw error;
      }
      emit('datasets');
      return index;
    },
    getIndex: () => index,
    getStateOutlines: () => boundaries.getStates(),
    getMode: () => mode,
    async setMode(next) {
      if (next !== 'live' && next !== 'demo') throw new TypeError('Unknown mode');
      if (next === mode) return;
      mode = next;
      emit('mode', { mode });
      for (const state of states.values()) {
        state.inputs = { meteo: null, ndvi: null, ndviDates: {} };
        if (state.features) rebuild(state);
      }
      await Promise.all(
        [...states.values()].filter((s) => s.features).map((s) => this.loadState(s.entry.id, { force: true })),
      );
    },
    focus(stateId) {
      focusedStateId = stateId;
      emit('datasets', { stateId });
    },
    getFocusedStateId: () => focusedStateId,
    /** Dataset descriptors for a state (or the focused one), plus geography. */
    getDatasets(stateId = focusedStateId) {
      const state = stateId ? states.get(stateId) : null;
      return { ...(state?.datasets || idleDatasets()), geography };
    },
    /** Load only a state's district boundaries (no data requests). */
    async ensureDistricts(stateId) {
      const state = slot(stateId);
      if (!state.features) {
        state.boundaryLoad ||= boundaries.getDistricts(stateId).then((collection) => {
          if (!collection) throw new Error('No district boundaries for this state');
          if (!state.features) {
            state.features = collection.features;
            rebuild(state);
          }
          return state.features;
        }).finally(() => {
          state.boundaryLoad = null;
        });
        return state.boundaryLoad;
      }
      return state.features;
    },
    async loadState(stateId, { force = false, bypassCache = false } = {}) {
      const state = slot(stateId);
      if (state.loading && !force) return state.loading;
      if (state.dataLoaded && !force) return state;
      const generation = ++state.generation;
      state.loading = (async () => {
        await this.ensureDistricts(stateId);
        state.dataLoaded = true;
        if (mode === 'demo') await loadDemoData(state, generation);
        else await loadLive(state, generation, bypassCache);
        return state;
      })().finally(() => {
        if (generation === state.generation) state.loading = null;
      });
      emit('state-loading', { stateId });
      return state.loading;
    },
    isStateLoaded: (stateId) => Boolean(states.get(stateId)?.features),
    getFeatures: (stateId) => states.get(stateId)?.features || null,
    getStateSummary: (stateId) => states.get(stateId)?.summary || null,
    getStateRecords: (stateId) => [...(states.get(stateId)?.records.values() || [])],
    getRecord(regionId) {
      for (const state of states.values())
        if (state.records.has(regionId)) return state.records.get(regionId);
      return null;
    },
    getLoadedRecords: () =>
      [...states.values()].flatMap((state) => [...state.records.values()]),
    getLoadedStateIds: () =>
      [...states.values()].filter((s) => s.features).map((s) => s.entry.id),
    refresh(stateId = focusedStateId) {
      if (!stateId || !states.get(stateId)?.features) return null;
      return this.loadState(stateId, { force: true, bypassCache: true });
    },
  });
}

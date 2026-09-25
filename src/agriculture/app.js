import * as Cesium from 'cesium';
import { createApplication } from '../app/application.js';
import { createApplicationViewer } from '../app/viewer.js';
import {
  governorRequestRender,
  holdContinuousRender,
  installRenderGovernor,
  releaseContinuousRender,
  uninstallRenderGovernor,
} from '../renderGovernor.js';
import { registerDataCredits } from '../data/dataCredits.js';
import { initLogoGaze } from '../logoGaze.js';
import { createPhotonGeocoder } from '../keylessGeocoder.js';
import { AGRIEYE_CREDITS } from './credits.js';
import { createAgriDataStore } from './data/store.js';
import { geometryContains } from './data/geography/boundaries.js';
import { STATUS } from './model/provenance.js';
import { createRegionRenderer } from './layers/regionRenderer.js';
import { LAYERS, LAYER_BY_ID, NO_DATA } from './layers/layerDefinitions.js';
import { BASEMAPS, createAgriMapController, createNdviOverlay } from './layers/basemaps.js';
import { createCameraController, INDIA_BBOX } from './camera.js';
import { buildPlaceIndex, searchPlaces } from './ai/places.js';
import { createAgricultureAgent } from './ai/agricultureAgent.js';
import { createSpeech } from './ai/speech.js';
import { escapeHtml as e, icon } from './ui/icons.js';
import { renderIndiaPanel, renderRegionPanel, renderStatePanel } from './ui/intelPanel.js';
import { renderSourcesDrawer, renderStatusRows, systemStatus } from './ui/statusPanel.js';

// AgriEye composition. Reuses God's Eye View's application lifecycle, viewer
// factory, map-source controller, render governor, credit registry, logo
// gaze and keyless geocoder; everything agricultural lives under
// src/agriculture (data → analysis → layers → ai → ui).

const $ = (id) => document.getElementById(id);
const INDIA_BIAS = `${INDIA_BBOX[1]},${INDIA_BBOX[0]}|${INDIA_BBOX[3]},${INDIA_BBOX[2]}`;

/**
 * Entity geometry is built asynchronously, and the idle render governor would
 * otherwise stop drawing before it is ready. Hold continuous rendering until
 * the data-source display reports ready, then let the globe go idle again.
 */
let pulseViewer = null;
let pulseTimer = null;
function pulseRender(reason = 'agrieye', settleMs = 600) {
  holdContinuousRender('agrieye-build');
  governorRequestRender(reason);
  clearTimeout(pulseTimer);
  const settle = () => {
    const display = pulseViewer && !pulseViewer.isDestroyed() ? pulseViewer.dataSourceDisplay : null;
    if (display && !display.ready) {
      pulseTimer = setTimeout(settle, 250);
      return;
    }
    releaseContinuousRender('agrieye-build');
  };
  pulseTimer = setTimeout(settle, settleMs);
}

let constructed = false;

/** Compose AgriEye once per page. Reload to start again. */
export function createAgriEyeApplication() {
  if (constructed) throw new Error('AgriEye already owns this page');
  constructed = true;
  const loadingScreen = $('loading-screen');
  const loaderStatus = loadingScreen.querySelector('.loader-status');
  const store = createAgriDataStore();
  const pulse = pulseRender;

  return createApplication({
    // ── Scene: globe, basemap, render governor ────────────────────────────
    async createScene({ defer, signal }) {
      loaderStatus.textContent = 'Configuring globe…';
      defer(initLogoGaze());
      const creditContainer = document.createElement('div');
      creditContainer.id = 'cesium-credits';
      document.body.appendChild(creditContainer);
      defer(() => creditContainer.remove());
      const viewer = createApplicationViewer({ container: 'cesiumContainer', creditContainer });
      defer(() => {
        uninstallRenderGovernor(viewer);
        if (!viewer.isDestroyed()) viewer.destroy();
      });
      pulseViewer = viewer;
      const scene = viewer.scene;
      scene.globe.show = true;
      scene.globe.baseColor = Cesium.Color.fromCssColorString('#050807');
      scene.globe.showGroundAtmosphere = true;
      scene.globe.enableLighting = false;
      scene.backgroundColor = Cesium.Color.BLACK;
      scene.fog.enabled = true;
      scene.skyAtmosphere.hueShift = 0.02;
      scene.skyAtmosphere.brightnessShift = -0.18;
      scene.screenSpaceCameraController.minimumZoomDistance = 15_000;
      scene.screenSpaceCameraController.maximumZoomDistance = 40_000_000;
      // Modest GPUs: fewer MSAA samples on low core counts.
      if ((navigator.hardwareConcurrency || 8) <= 4) scene.msaaSamples = 1;
      viewer.screenSpaceEventHandler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
      installRenderGovernor(viewer);
      registerDataCredits(viewer, AGRIEYE_CREDITS);

      const camera = createCameraController(viewer, {
        onFlightStart: () => holdContinuousRender('agrieye-flight'),
        onFlightEnd: () => releaseContinuousRender('agrieye-flight'),
      });
      camera.setSpaceView();

      loaderStatus.textContent = 'Loading satellite basemap…';
      const maps = createAgriMapController(viewer, {
        requestRender: governorRequestRender,
        onError: (message) => controls.toast(message),
        onChange: () => controls.syncBasemap(),
      });
      defer(() => maps.destroy());
      await maps.setStack('esri-imagery', { silent: true });
      signal.throwIfAborted();
      return { viewer, camera, maps };
    },

    // ── Controls: layers, panels, pointer interaction ─────────────────────
    createControls({ scene: sceneParts, defer }) {
      const { viewer, camera, maps } = sceneParts;
      const renderer = createRegionRenderer(viewer, { requestRender: pulse });
      defer(() => renderer.destroy());
      const ndvi = createNdviOverlay(viewer, { requestRender: pulse });
      defer(() => ndvi.destroy());
      controls.init({ viewer, camera, maps, renderer, ndvi, store });
      defer(() => controls.destroy());
      return controls;
    },

    // ── Data: boundaries index and state outlines ─────────────────────────
    async createData({ controls: ui, defer }) {
      loaderStatus.textContent = 'Loading India boundaries…';
      defer(store.subscribe((event) => ui.onStoreEvent(event)));
      await store.init();
      ui.setStateOutlines(await store.getStateOutlines());
      return store;
    },

    // ── Tools: agent, voice, command bar, keyboard, intro ─────────────────
    createTools({ controls: ui, defer }) {
      const agent = createAgricultureAgent({
        store,
        getPlaces: ui.getPlaces,
        getSelection: ui.getSelection,
      });
      ui.attachAgent(agent);
      defer(ui.bindKeyboard());
      // Development-only inspection handle for QA scripts.
      if (import.meta.env?.DEV) window.__agrieye = { store, agent, controls: ui };
      loadingScreen.classList.add('hidden');
      ui.startIntro();
      return { agent };
    },
  });

}

// The controls object is module-scoped so scene callbacks can reach it
// before construction completes; it is initialized in createControls.
const controls = createControlsObject();

function createControlsObject() {
  let viewer, camera, maps, renderer, ndvi, agent, speech;
  let places = [];
  let stateOutlines = null;
  let handler = null;
  let refreshQueued = false;
  let introDone = false;
  const cleanups = [];
  const ui = {
    layerId: 'agriculture',
    variant: 'agriculturalRisk',
    selectedRegionId: null,
    focusedStateId: null,
    highlight: null,
    hovered: null,
    extrude: true,
    ndviImagery: false,
    panel: 'none',
    statusCollapsed: false,
  };

  let controlsStore = null;
  const store = () => controlsStore;
  function toast(message, ms = 3400) {
    const el = $('ae-toast');
    if (!el) return;
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.classList.remove('show'), ms);
  }

  const pulse = () => pulseRender('agrieye-ui');

  // ── Rendering state → globe ─────────────────────────────────────────────
  function allRecords() {
    return new Map(store().getLoadedRecords().map((r) => [r.id, r]));
  }

  function applyTheme(extra = {}) {
    renderer.update({
      layerId: ui.layerId,
      variant: ui.variant,
      extrude: ui.extrude,
      selectedId: ui.selectedRegionId,
      focusedStateId: ui.focusedStateId,
      highlight: ui.highlight,
      hovered: ui.hovered,
      fillOpacity: ui.layerId === 'vegetation' && ui.ndviImagery ? 0.35 : 1,
      ...extra,
    });
  }

  function scheduleRefresh() {
    if (refreshQueued) return;
    refreshQueued = true;
    requestAnimationFrame(() => {
      refreshQueued = false;
      applyTheme({ records: allRecords() });
      renderStatus();
      renderLegend();
      renderPanel();
    });
  }

  // ── Layers ──────────────────────────────────────────────────────────────
  function setLayer(id, variant) {
    if (!LAYER_BY_ID[id]) return;
    ui.layerId = id;
    if (variant && LAYER_BY_ID[id].variants?.[variant]) ui.variant = variant;
    if (id === 'vegetation' && ui.ndviImagery) ndvi.show(currentNdviDate());
    else ndvi.hide();
    renderLayerButtons();
    renderLegend();
    applyTheme();
    pulse();
  }

  function currentNdviDate() {
    const d = store().getDatasets().vegetation;
    return d?.observedAt && /^\d{4}-\d{2}-\d{2}$/.test(d.observedAt) ? d.observedAt : null;
  }

  function renderLayerButtons() {
    const host = $('ae-layer-buttons');
    const datasets = store().getDatasets();
    host.innerHTML = LAYERS.map((layer) => {
      const loading = layer.datasets.some((key) => datasets[key]?.status === STATUS.LOADING);
      return `<button class="ae-layer-btn" role="radio" data-layer="${layer.id}" aria-checked="${layer.id === ui.layerId}" title="${e(layer.description)}"${loading ? ' data-loading' : ''}>
        ${icon(layer.icon)}<span>${e(layer.label)}</span><span class="ae-kbd">${layer.shortcut}</span>
      </button>`;
    }).join('');
  }

  function renderLegend() {
    const layer = LAYER_BY_ID[ui.layerId];
    const host = $('ae-legend');
    const records = [...allRecords().values()];
    const counts = new Map();
    for (const record of records) {
      const band = layer.classify(record, ui.variant);
      counts.set(band.key, (counts.get(band.key) || 0) + 1);
    }
    const items = layer.legend.map(
      (band) => `<li><i style="background:${band.color}"></i>${e(band.label)}${records.length && layer.id !== 'agriculture' ? `<em style="margin-left:auto;font-style:normal;font-family:var(--ae-mono);font-size:10px">${counts.get(band.key) || 0}</em>` : ''}</li>`,
    );
    if (layer.id !== 'agriculture')
      items.push(`<li><i style="background:${NO_DATA.color}"></i>No data${records.length ? `<em style="margin-left:auto;font-style:normal;font-family:var(--ae-mono);font-size:10px">${counts.get('NONE') || 0}</em>` : ''}</li>`);
    host.className = 'ae-legend';
    host.innerHTML = `
      <div class="ae-legend-title">${e(layer.variants ? layer.variants[ui.variant] : layer.label)}</div>
      <p class="ae-legend-desc">${e(layer.description)}</p>
      ${layer.variants ? `<select id="ae-variant" aria-label="Risk indicator">${Object.entries(layer.variants).map(([key, label]) => `<option value="${key}"${key === ui.variant ? ' selected' : ''}>${e(label)}</option>`).join('')}</select>` : ''}
      <ul class="ae-legend-items">${items.join('')}</ul>
      ${layer.id === 'vegetation' ? `<label class="ae-switch"><input type="checkbox" id="ae-ndvi-imagery"${ui.ndviImagery ? ' checked' : ''} /><span>MODIS NDVI imagery</span></label>` : ''}
      ${!records.length ? '<p class="ae-legend-desc" style="margin-top:8px">Select a state to load district data.</p>' : ''}`;
  }

  // ── Status panel ────────────────────────────────────────────────────────
  function renderStatus() {
    const datasets = store().getDatasets();
    const mode = store().getMode();
    $('ae-status-rows').innerHTML = renderStatusRows(datasets);
    const system = systemStatus(datasets, mode);
    $('ae-system').dataset.tone = system.tone;
    $('ae-system-text').textContent = system.text;
    const chip = $('ae-mode-chip');
    chip.dataset.mode = mode;
    chip.textContent = mode === 'demo' ? 'DEMO DATA' : 'LIVE MODE';
    chip.title =
      mode === 'demo'
        ? 'Demo dataset: an archived snapshot of open data, labelled with its capture date. Not current conditions.'
        : 'Live mode fetches the latest available open data. Each source shows its own freshness.';
    $('ae-demo-toggle').checked = mode === 'demo';
    const failed = ['weather', 'soil', 'vegetation'].filter((key) => datasets[key]?.status === STATUS.ERROR);
    const alert = $('ae-status-alert');
    if (failed.length && mode === 'live') {
      alert.hidden = false;
      alert.innerHTML = `${e(failed.map((key) => datasets[key].label).join(', '))} temporarily unavailable (${e(datasets[failed[0]].message || 'request failed')}). The rest of the map keeps working.<button data-action="use-demo">Use demo dataset</button>`;
    } else alert.hidden = true;
    renderLayerButtons();
  }

  // ── Panels ──────────────────────────────────────────────────────────────
  function showPanel(kind) {
    ui.panel = kind;
    renderPanel();
  }

  function renderPanel() {
    const panel = $('ae-panel');
    const s = store();
    const demo = s.getMode() === 'demo';
    const scroll = panel.scrollTop;
    const previous = panel.dataset.key;
    let html = '';
    let key = ui.panel;
    if (ui.panel === 'region' && ui.selectedRegionId) {
      const record = s.getRecord(ui.selectedRegionId);
      if (record) html = renderRegionPanel(record, { demo });
      key = `region:${ui.selectedRegionId}`;
    } else if (ui.panel === 'state' && ui.focusedStateId) {
      const entry = s.getIndex()?.states.find((st) => st.id === ui.focusedStateId);
      if (entry)
        html = renderStatePanel(entry, s.getStateSummary(entry.id), s.getStateRecords(entry.id), s.getDatasets(entry.id), {
          demo,
          loading: ['weather', 'vegetation'].some((k) => s.getDatasets(entry.id)[k]?.status === STATUS.LOADING),
        });
      key = `state:${ui.focusedStateId}`;
    } else if (ui.panel === 'india') {
      html = renderIndiaPanel(s.getIndex());
    }
    panel.hidden = !html;
    if (!html) return;
    // Re-rendering the same subject keeps scroll and open disclosures.
    const openDetails = [...panel.querySelectorAll('details[open] summary span:first-child')].map((n) => n.textContent);
    panel.innerHTML = html;
    panel.dataset.key = key;
    if (previous === key) {
      panel.scrollTop = scroll;
      for (const d of panel.querySelectorAll('details'))
        if (openDetails.includes(d.querySelector('summary span')?.textContent)) d.open = true;
      panel.style.animation = 'none';
    } else {
      panel.style.animation = '';
      panel.scrollTop = 0;
    }
  }

  function openSources() {
    const drawer = $('ae-sources');
    drawer.innerHTML = renderSourcesDrawer(store().getDatasets());
    drawer.hidden = false;
    drawer.querySelector('[data-action="close-sources"]')?.focus();
  }

  // ── Breadcrumbs ─────────────────────────────────────────────────────────
  function renderCrumbs() {
    const s = store();
    const crumbs = [['india', 'INDIA']];
    if (ui.focusedStateId) {
      const entry = s.getIndex()?.states.find((st) => st.id === ui.focusedStateId);
      if (entry) crumbs.push([`state:${entry.id}`, entry.name.toUpperCase()]);
    }
    if (ui.selectedRegionId) {
      const record = s.getRecord(ui.selectedRegionId);
      if (record) crumbs.push([`region:${record.id}`, record.name.toUpperCase()]);
    }
    $('ae-crumbs').innerHTML = crumbs.map(([id, label]) => `<li><button data-crumb="${e(id)}">${e(label)}</button></li>`).join('');
  }

  // ── Navigation ──────────────────────────────────────────────────────────
  function stateEntry(stateId) {
    return store().getIndex()?.states.find((st) => st.id === stateId) || null;
  }

  async function focusState(stateId, { fly = true, keepHighlight = false } = {}) {
    const entry = stateEntry(stateId);
    if (!entry) return;
    ui.focusedStateId = stateId;
    ui.selectedRegionId = null;
    if (!keepHighlight) ui.highlight = null;
    store().focus(stateId);
    showPanel('state');
    renderCrumbs();
    applyTheme();
    if (fly) camera.flyToState(entry);
    try {
      const features = await store().ensureDistricts(stateId);
      renderer.setDistricts(stateId, features);
      scheduleRefresh();
      await store().loadState(stateId);
    } catch (error) {
      toast(`Could not load ${entry.name}: ${error.message}`);
    }
  }

  async function selectRegion(regionId, { fly = true } = {}) {
    const stateId = regionId.split('--')[0];
    try {
      const features = await store().ensureDistricts(stateId);
      renderer.setDistricts(stateId, features);
    } catch (error) {
      toast(`Could not load boundaries: ${error.message}`);
      return;
    }
    const record = store().getRecord(regionId);
    if (!record) return;
    ui.focusedStateId = stateId;
    ui.selectedRegionId = regionId;
    store().focus(stateId);
    showPanel('region');
    renderCrumbs();
    applyTheme({ records: allRecords() });
    if (fly) camera.flyToRegion(record);
    store().loadState(stateId).catch((error) => toast(error.message));
  }

  function goIndia({ fly = true } = {}) {
    ui.selectedRegionId = null;
    ui.focusedStateId = null;
    ui.highlight = null;
    store().focus(null);
    showPanel('india');
    renderCrumbs();
    applyTheme();
    renderStatus();
    if (fly) camera.flyToIndia({ duration: 2.6 });
  }

  function deselect() {
    if (ui.selectedRegionId) {
      ui.selectedRegionId = null;
      showPanel(ui.focusedStateId ? 'state' : 'none');
    } else if (ui.highlight) {
      ui.highlight = null;
    } else {
      showPanel('none');
    }
    renderCrumbs();
    applyTheme();
  }

  // ── Pointer interaction ─────────────────────────────────────────────────
  function tooltipFor(target) {
    const s = store();
    if (target.kind === 'state') {
      const entry = stateEntry(target.id);
      if (!entry) return '';
      const loaded = s.getStateSummary(target.id);
      return `<strong>${e(entry.name)}</strong><span>${entry.districtCount} districts${loaded ? ` · ${loaded.counts.riskHigh} at high risk` : ''}</span><em>CLICK TO OPEN STATE</em>`;
    }
    const record = s.getRecord(target.id);
    if (!record) return '';
    const layer = LAYER_BY_ID[ui.layerId];
    return `<strong>${e(record.name)}</strong><span>${e(layer.summary(record, ui.variant))}</span><em>${e(record.state.toUpperCase())} · CLICK FOR ANALYSIS</em>`;
  }

  function bindPointer() {
    handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    const tooltip = $('ae-tooltip');
    let pending = null;
    let lastPick = 0;
    let dragging = false;
    const pickAt = (position) => {
      const target = renderer.pick(position);
      const same = target?.kind === ui.hovered?.kind && target?.id === ui.hovered?.id;
      if (!same) {
        ui.hovered = target;
        applyTheme();
      }
      viewer.scene.canvas.style.cursor = target ? 'pointer' : '';
      if (target) {
        const html = tooltipFor(target);
        tooltip.innerHTML = html;
        tooltip.hidden = !html;
        tooltip.style.left = `${position.x}px`;
        tooltip.style.top = `${position.y}px`;
      } else tooltip.hidden = true;
    };
    handler.setInputAction(() => (dragging = true), Cesium.ScreenSpaceEventType.LEFT_DOWN);
    handler.setInputAction(() => (dragging = false), Cesium.ScreenSpaceEventType.LEFT_UP);
    handler.setInputAction((movement) => {
      if (dragging || camera.isFlying()) {
        tooltip.hidden = true;
        return;
      }
      pending = Cesium.Cartesian2.clone(movement.endPosition);
      tooltip.style.left = `${pending.x}px`;
      tooltip.style.top = `${pending.y}px`;
      const now = performance.now();
      if (now - lastPick < 60) {
        clearTimeout(pickAt.timer);
        pickAt.timer = setTimeout(() => pending && pickAt(pending), 70);
        return;
      }
      lastPick = now;
      pickAt(pending);
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
    handler.setInputAction((click) => {
      const target = renderer.pick(click.position);
      tooltip.hidden = true;
      if (!target) return;
      if (target.kind === 'state') focusState(target.id);
      else selectRegion(target.id);
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  }

  // ── Command bar, suggestions, agent ─────────────────────────────────────
  let suggestIndex = -1;
  let suggestions = [];

  function renderSuggestions(query) {
    const list = $('ae-suggest');
    const q = query.trim();
    if (!q) {
      list.hidden = true;
      suggestions = [];
      return;
    }
    const matches = searchPlaces(places, q, 6).map((place) => ({ type: 'place', place }));
    const looksLikeQuestion = q.split(/\s+/).length > 2 || /\?|show|which|where|why|compare|what/i.test(q);
    suggestions = looksLikeQuestion ? [{ type: 'ask', q }, ...matches] : [...matches, { type: 'ask', q }];
    suggestIndex = -1;
    list.innerHTML = suggestions
      .map((s, i) =>
        s.type === 'ask'
          ? `<li role="option" data-index="${i}">${icon('send', { size: 14 })}<span>Ask AgriEye: “${e(s.q)}”</span><small>AI</small></li>`
          : `<li role="option" data-index="${i}">${icon(s.place.kind === 'district' ? 'agriculture' : 'home', { size: 14 })}<span>${e(s.place.name)}${s.place.stateName ? ` <small style="margin:0;letter-spacing:0">${e(s.place.stateName)}</small>` : ''}</span><small>${s.place.kind.toUpperCase()}</small></li>`,
      )
      .join('');
    list.hidden = !suggestions.length;
  }

  function chooseSuggestion(index) {
    const choice = suggestions[index];
    $('ae-suggest').hidden = true;
    if (!choice) return;
    if (choice.type === 'ask') return runQuery(choice.q);
    $('ae-command-input').value = '';
    navigateToPlace(choice.place);
  }

  function navigateToPlace(place) {
    if (place.kind === 'country') goIndia();
    else if (place.kind === 'state') focusState(place.id);
    else selectRegion(place.id);
  }

  async function executeActions(actions) {
    const order = ['mode', 'layer', 'fly', 'select', 'highlight', 'clearHighlight', 'deselect'];
    const sorted = [...actions].sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
    for (const action of sorted) {
      switch (action.type) {
        case 'mode':
          await setMode(action.mode);
          break;
        case 'layer':
          setLayer(action.id, action.variant);
          break;
        case 'fly':
          if (action.target === 'india') goIndia();
          else if (action.stateId) {
            if (action.stateId !== ui.focusedStateId || ui.selectedRegionId) focusState(action.stateId, { keepHighlight: true });
            else camera.flyToState(stateEntry(action.stateId));
          } else if (action.bbox) camera.flyToBBox(action.bbox, { pitchDeg: -52, rangeScale: 1.15 });
          break;
        case 'select':
          await selectRegion(action.regionId, { fly: !sorted.some((a) => a.type === 'fly') });
          break;
        case 'highlight':
          ui.highlight = new Set(action.ids);
          applyTheme({ records: allRecords() });
          break;
        case 'clearHighlight':
          ui.highlight = null;
          applyTheme();
          break;
        case 'deselect':
          ui.selectedRegionId = null;
          renderCrumbs();
          applyTheme();
          break;
      }
    }
    pulse();
  }

  function renderAnswer(question, result, { pending = false } = {}) {
    const box = $('ae-answer');
    box.hidden = false;
    if (pending) {
      box.innerHTML = `<div class="ae-answer-head">AGRIEYE ANALYST <button class="ae-icon-btn" data-action="close-answer" aria-label="Close answer">${icon('close', { size: 14 })}</button></div>
        <div class="ae-answer-q">${e(question)}</div><p class="ae-muted ae-loading-line">Reading the loaded data…</p>`;
      return;
    }
    box.innerHTML = `<div class="ae-answer-head">AGRIEYE ANALYST${result.demo ? ' · <span class="ae-demo-tag">DEMO DATA</span>' : ''}<button class="ae-icon-btn" data-action="close-answer" aria-label="Close answer">${icon('close', { size: 14 })}</button></div>
      <div class="ae-answer-q">${e(question)}</div>
      <div class="ae-answer-text">${e(result.text)}</div>
      ${result.sources ? `<div class="ae-answer-sources">Based on currently loaded data: ${e(result.sources)}</div>` : ''}
      ${result.suggestions?.length ? `<div class="ae-chips">${result.suggestions.map((q) => `<button class="ae-chip" data-action="ask" data-q="${e(q)}">${e(q)}</button>`).join('')}</div>` : ''}`;
  }

  const photon = createPhotonGeocoder();

  async function geocodeFallback(query) {
    const outcome = await photon.geocode(query, { bias: INDIA_BIAS }).catch(() => null);
    const place = outcome?.place;
    if (!place) return null;
    const point = [place.lng, place.lat];
    const inIndia =
      point[0] >= INDIA_BBOX[0] && point[0] <= INDIA_BBOX[2] && point[1] >= INDIA_BBOX[1] && point[1] <= INDIA_BBOX[3];
    const state = inIndia ? stateOutlines?.features.find((f) => geometryContains(f.geometry, point)) : null;
    if (!state) {
      camera.flyToBBox([place.lng - 0.4, place.lat - 0.3, place.lng + 0.4, place.lat + 0.3], { pitchDeg: -50 });
      return {
        text: `${place.label || place.name} — outside AgriEye's India coverage. Showing the location only.`,
        actions: [],
        sources: 'Place search: Photon / © OpenStreetMap contributors',
      };
    }
    const features = await store().ensureDistricts(state.properties.id);
    renderer.setDistricts(state.properties.id, features);
    const district = features.find((f) => geometryContains(f.geometry, point));
    if (district) await selectRegion(district.properties.id, { fly: false });
    else await focusState(state.properties.id, { fly: false });
    camera.flyToBBox([place.lng - 0.35, place.lat - 0.25, place.lng + 0.35, place.lat + 0.25], { pitchDeg: -52 });
    return {
      text: `${place.label || place.name} lies in ${district ? `${district.properties.name} district (Census 2011 boundaries), ` : ''}${state.properties.name}. District-level analysis is shown in the panel; AgriEye's data is regional, not field-level.`,
      actions: [],
      sources: 'Place search: Photon / © OpenStreetMap contributors',
      suggestions: district ? [`Why is ${district.properties.name} at risk?`] : [],
    };
  }

  async function runQuery(raw) {
    const question = String(raw || '').trim();
    if (!question || !agent) return;
    $('ae-command-input').value = '';
    $('ae-suggest').hidden = true;
    renderAnswer(question, null, { pending: true });
    let result;
    try {
      result = await agent.ask(question);
      if (result.status === 'unknown' && question.split(/\s+/).length <= 5 && !/\?/.test(question)) {
        const geo = await geocodeFallback(question);
        if (geo) result = { ...geo, status: 'ok' };
      }
      await executeActions(result.actions || []);
    } catch (error) {
      console.error('[AgriEye] query failed', error);
      result = { text: `Something went wrong while answering: ${error.message}`, sources: '' };
    }
    renderAnswer(question, result);
    speech?.speak(result.text);
  }

  async function setMode(mode) {
    if (store().getMode() === mode) return;
    toast(mode === 'demo' ? 'Demo dataset active — archived open-data snapshot, not current conditions.' : 'Live mode — requesting the latest available open data.');
    await store().setMode(mode);
    renderStatus();
  }

  // ── Globe controls ──────────────────────────────────────────────────────
  function renderGlobeControls() {
    const host = $('ae-globe-controls');
    host.innerHTML = `
      <button class="ae-icon-btn" data-globe="zoom-in" title="Zoom in (+)">${icon('plus')}</button>
      <button class="ae-icon-btn" data-globe="zoom-out" title="Zoom out (−)">${icon('minus')}</button>
      <button class="ae-icon-btn" data-globe="north" title="North up (N)">${icon('compass')}</button>
      <button class="ae-icon-btn" data-globe="india" title="India view (H)">${icon('home')}</button>
      <button class="ae-icon-btn" data-globe="extrude" aria-pressed="${ui.extrude}" title="3D extrusion (E)">${icon('extrude')}</button>
      <span class="ae-sep"></span>
      ${BASEMAPS.map((b) => `<button class="ae-basemap-btn" data-basemap="${b.id}" aria-pressed="false" title="${e(b.detail)}">${e(b.label.toUpperCase())}</button>`).join('')}`;
    syncBasemap();
  }

  function syncBasemap() {
    const active = maps?.getActiveId?.();
    for (const button of document.querySelectorAll('[data-basemap]'))
      button.setAttribute('aria-pressed', String(button.dataset.basemap === active));
  }

  function globeAction(action) {
    if (action === 'zoom-in') camera.zoom(0.55);
    else if (action === 'zoom-out') camera.zoom(1.8);
    else if (action === 'north') camera.resetNorth();
    else if (action === 'india') goIndia();
    else if (action === 'extrude') {
      ui.extrude = !ui.extrude;
      document.querySelector('[data-globe="extrude"]')?.setAttribute('aria-pressed', String(ui.extrude));
      applyTheme();
    }
    pulse();
  }

  // ── Global click delegation ─────────────────────────────────────────────
  function onDocumentClick(event) {
    const target = event.target.closest('[data-action],[data-layer],[data-crumb],[data-globe],[data-basemap],#ae-suggest li');
    if (!target) return;
    if (target.matches('#ae-suggest li')) return chooseSuggestion(Number(target.dataset.index));
    if (target.dataset.layer) {
      const id = target.dataset.layer;
      return setLayer(id === ui.layerId && id !== 'agriculture' ? 'agriculture' : id);
    }
    if (target.dataset.globe) return globeAction(target.dataset.globe);
    if (target.dataset.basemap) {
      maps.setStack(target.dataset.basemap).then(syncBasemap);
      return;
    }
    if (target.dataset.crumb) {
      const [kind, id] = target.dataset.crumb.split(':');
      if (kind === 'india') return goIndia();
      if (kind === 'state') return focusState(id);
      if (kind === 'region') {
        const record = store().getRecord(id);
        if (record) camera.flyToRegion(record);
      }
      return;
    }
    switch (target.dataset.action) {
      case 'close-panel':
        if (ui.panel === 'region') deselect();
        else showPanel('none');
        break;
      case 'select-region':
        selectRegion(target.dataset.id);
        break;
      case 'ask':
        runQuery(target.dataset.q);
        break;
      case 'open-sources':
        openSources();
        break;
      case 'close-sources':
        $('ae-sources').hidden = true;
        break;
      case 'close-answer':
        $('ae-answer').hidden = true;
        break;
      case 'refresh': {
        const refreshed = store().refresh();
        toast(refreshed ? 'Re-requesting data for the focused state…' : 'Open a state first to refresh its data.');
        break;
      }
      case 'use-demo':
        setMode('demo');
        break;
    }
  }

  function onDocumentChange(event) {
    if (event.target.id === 'ae-demo-toggle') setMode(event.target.checked ? 'demo' : 'live');
    if (event.target.id === 'ae-variant') setLayer('risk', event.target.value);
    if (event.target.id === 'ae-ndvi-imagery') {
      ui.ndviImagery = event.target.checked;
      if (ui.ndviImagery) {
        ndvi.show(currentNdviDate());
        toast('MODIS NDVI imagery: latest available 8-day composite from NASA GIBS.');
      } else ndvi.hide();
      applyTheme();
    }
  }

  function bindCommandBar() {
    const form = $('ae-command-form');
    const input = $('ae-command-input');
    form.querySelector('.ae-command-icon').innerHTML = icon('search');
    $('ae-send').innerHTML = icon('send');
    $('ae-mic').innerHTML = icon('mic');
    $('ae-speak').innerHTML = icon('speaker');
    let debounce = null;
    input.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => renderSuggestions(input.value), 120);
    });
    input.addEventListener('keydown', (event) => {
      const list = $('ae-suggest');
      const items = [...list.querySelectorAll('li')];
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        if (!items.length) return;
        event.preventDefault();
        suggestIndex = (suggestIndex + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items.forEach((li, i) => li.setAttribute('aria-selected', String(i === suggestIndex)));
      } else if (event.key === 'Escape') {
        list.hidden = true;
        input.blur();
      }
    });
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      clearTimeout(debounce);
      if (suggestIndex >= 0 && !$('ae-suggest').hidden) return chooseSuggestion(suggestIndex);
      const value = input.value.trim();
      const exact = searchPlaces(places, value, 1)[0];
      if (exact && exact.keys.includes(value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim())) {
        input.value = '';
        $('ae-suggest').hidden = true;
        return navigateToPlace(exact);
      }
      runQuery(value);
    });
    input.addEventListener('blur', () => setTimeout(() => ($('ae-suggest').hidden = true), 150));

    speech = createSpeech({
      onResult: (text, final) => {
        input.value = text;
        if (final) runQuery(text);
      },
      onState: (state, detail) => {
        $('ae-mic').dataset.state = state;
        if (state === 'error' && detail !== 'no-speech' && detail !== 'aborted')
          toast(`Voice input unavailable (${detail}). Type your question instead.`);
      },
    });
    const mic = $('ae-mic');
    if (!speech.supported) {
      mic.disabled = true;
      mic.title = 'Voice input needs a browser with speech recognition (Chrome or Edge). Type instead.';
      mic.style.opacity = 0.35;
    }
    mic.addEventListener('click', () => (speech.isListening() ? speech.stop() : speech.start()));
    const speak = $('ae-speak');
    if (!speech.canSpeak) speak.hidden = true;
    speak.addEventListener('click', () => {
      speech.setSpeakEnabled(!speech.isSpeakEnabled());
      speak.setAttribute('aria-pressed', String(speech.isSpeakEnabled()));
    });
  }

  return {
    init(parts) {
      ({ viewer, camera, maps, renderer, ndvi } = parts);
      controlsStore = parts.store;
      renderLayerButtons();
      renderLegend();
      renderGlobeControls();
      bindCommandBar();
      bindPointer();
      $('ae-status-toggle').addEventListener('click', () => {
        ui.statusCollapsed = !ui.statusCollapsed;
        $('ae-status').toggleAttribute('data-collapsed', ui.statusCollapsed);
        $('ae-status-toggle').setAttribute('aria-expanded', String(!ui.statusCollapsed));
      });
      if (window.matchMedia('(max-width: 820px)').matches) $('ae-status-toggle').click();
      document.addEventListener('click', onDocumentClick);
      document.addEventListener('change', onDocumentChange);
      cleanups.push(() => document.removeEventListener('click', onDocumentClick));
      cleanups.push(() => document.removeEventListener('change', onDocumentChange));
    },
    toast,
    syncBasemap,
    setStateOutlines(collection) {
      stateOutlines = collection;
      places = buildPlaceIndex(store().getIndex());
      renderer.setStates(collection);
      renderStatus();
    },
    onStoreEvent(event) {
      if (event.type === 'state-updated' && event.stateId) {
        const features = store().getFeatures(event.stateId);
        if (features) renderer.setDistricts(event.stateId, features);
      }
      // Live imagery would contradict an archived demo snapshot.
      if (event.type === 'mode') {
        ui.ndviImagery = false;
        ndvi.hide();
        applyTheme();
      }
      scheduleRefresh();
    },
    getPlaces: () => places,
    getSelection: () => ({ regionId: ui.selectedRegionId, stateId: ui.focusedStateId }),
    attachAgent(instance) {
      agent = instance;
    },
    bindKeyboard() {
      const onKey = (event) => {
        const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName);
        if (event.key === 'Escape') {
          if (!$('ae-sources').hidden) $('ae-sources').hidden = true;
          else if (!$('ae-answer').hidden) $('ae-answer').hidden = true;
          else if (!typing) deselect();
          return;
        }
        if (typing || event.ctrlKey || event.metaKey || event.altKey) return;
        const layer = LAYERS.find((l) => l.shortcut === event.key);
        if (layer) return setLayer(layer.id === ui.layerId && layer.id !== 'agriculture' ? 'agriculture' : layer.id);
        if (event.key === '/') {
          event.preventDefault();
          $('ae-command-input').focus();
        } else if (event.key === 'h' || event.key === 'H') goIndia();
        else if (event.key === 'd' || event.key === 'D') $('ae-status-toggle').click();
        else if (event.key === 'e' || event.key === 'E') globeAction('extrude');
        else if (event.key === 'n' || event.key === 'N') globeAction('north');
        else if (event.key === '+' || event.key === '=') globeAction('zoom-in');
        else if (event.key === '-') globeAction('zoom-out');
      };
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    },
    async startIntro() {
      if (introDone) return;
      introDone = true;
      const params = new URLSearchParams(location.search);
      if (params.get('demo') === '1') await setMode('demo');
      showPanel('none');
      renderCrumbs();
      renderStatus();
      await new Promise((resolve) => setTimeout(resolve, 500));
      await camera.flyToIndia();
      const region = params.get('region');
      const state = params.get('state');
      const query = params.get('q');
      if (region) await selectRegion(region);
      else if (state) await focusState(state);
      else {
        showPanel('india');
        toast('Select a state — or ask AgriEye a question below.');
      }
      if (query) runQuery(query);
    },
    destroy() {
      handler?.destroy();
      for (const cleanup of cleanups.splice(0)) cleanup();
    },
  };
}

export { controls as _agrieyeControls };

import { escapeHtml as e, icon } from './icons.js';
import { formatTimestamp } from './format.js';
import { FRESHNESS_LABEL, STATUS, STATUS_LABEL, describeAge } from '../model/provenance.js';
import { DATASETS, PENDING_ADAPTERS } from '../data/catalog.js';
import { RISK_WEIGHTS } from '../analysis/agriculturalRisk.js';
import { SOIL_ASSUMPTION } from '../data/soil/soilMoisture.js';

const ROWS = [
  ['weather', 'Weather'],
  ['vegetation', 'Satellite'],
  ['soil', 'Soil moisture'],
  ['geography', 'Boundaries'],
];

/** Overall system line for the brand block. */
export function systemStatus(datasets, mode) {
  const statuses = ROWS.map(([key]) => datasets[key]?.status);
  if (mode === 'demo') return { tone: 'demo', text: 'DEMO DATASET ACTIVE' };
  if (statuses.includes(STATUS.ERROR)) return { tone: 'warn', text: 'DATA SYSTEMS DEGRADED' };
  if (statuses.includes(STATUS.LOADING)) return { tone: 'busy', text: 'SYNCING DATA SOURCES' };
  if (statuses.includes(STATUS.STALE)) return { tone: 'warn', text: 'SHOWING CACHED DATA' };
  return { tone: 'ok', text: 'DATA SYSTEMS ONLINE' };
}

export function renderStatusRows(datasets) {
  return ROWS.map(([key, label]) => {
    const d = datasets[key];
    const time = d.observedAt
      ? `${formatTimestamp(d.observedAt)}${describeAge(d.observedAt) ? ` · ${describeAge(d.observedAt)}` : ''}`
      : d.status === STATUS.IDLE && key !== 'geography'
        ? 'Loads when a state is opened'
        : d.message || '';
    return `<li class="ae-status-row" data-status="${e(d.status)}" title="${e(d.message || d.product)}">
      <span class="ae-dot" data-status="${e(d.status)}"></span>
      <span class="ae-status-name">${e(label)}</span>
      <span class="ae-fr-badge" data-fresh="${e(d.freshness)}">${e(FRESHNESS_LABEL[d.freshness])}</span>
      <span class="ae-status-state">${e(STATUS_LABEL[d.status])}</span>
      <span class="ae-status-time">${e(time)}</span>
    </li>`;
  }).join('');
}

export function renderSourcesDrawer(datasets) {
  const row = (d) => `<tr>
    <td><strong>${e(d.label)}</strong><br><a href="${e(d.sourceUrl)}" target="_blank" rel="noopener">${e(d.source)}</a></td>
    <td>${e(d.product)}<br><small>${e(d.resolution)}</small></td>
    <td><span class="ae-fr-badge" data-fresh="${e(d.freshness)}">${e(FRESHNESS_LABEL[d.freshness])}</span><br><small>${e(d.dataType || '')}</small></td>
    <td><span class="ae-dot" data-status="${e(d.status)}"></span> ${e(STATUS_LABEL[d.status])}<br><small>${e(d.observedAt ? formatTimestamp(d.observedAt) : '')}</small>${d.message ? `<br><small>${e(d.message)}</small>` : ''}</td>
    <td><small>${e(d.license || '')}</small></td>
  </tr>`;
  const current = ['weather', 'soil', 'vegetation', 'geography'].map((key) => datasets[key] || DATASETS[key]);
  return `
  <header class="ae-panel-head">
    <div><div class="ae-kicker">TRUST &amp; TRANSPARENCY</div><h2>Sources &amp; method</h2></div>
    <button class="ae-icon-btn" data-action="close-sources" aria-label="Close sources">${icon('close')}</button>
  </header>
  <section class="ae-section">
    <h3>Data sources in use</h3>
    <div class="ae-table-wrap"><table class="ae-table">
      <thead><tr><th>Dataset</th><th>Product</th><th>Freshness</th><th>Status</th><th>Licence</th></tr></thead>
      <tbody>${current.map(row).join('')}</tbody>
    </table></div>
    <p class="ae-note">Basemaps: Esri World Imagery, Copernicus Sentinel-2 cloudless 2023 (EOX, CC BY-NC-SA 4.0), OpenStreetMap (ODbL). Attribution is listed in the credits at the bottom left.</p>
  </section>
  <section class="ae-section">
    <h3>Adapters not connected</h3>
    <ul class="ae-reasons">${PENDING_ADAPTERS.map((p) => `<li><strong>${e(p.label)}</strong> — ${e(p.reason)}</li>`).join('')}</ul>
  </section>
  <section class="ae-section ae-method">
    <h3>How the indicators are computed</h3>
    <p>All indicators are deterministic and explainable. Each input is converted to a 0–1 stress, weighted, and summed to a 0–100 score. Missing inputs are excluded and reported; below 60% input coverage the result is <em>insufficient data</em>.</p>
    <dl>
      <dt>Agricultural risk</dt><dd>Soil dryness ${RISK_WEIGHTS.soil * 100}% · vegetation condition ${RISK_WEIGHTS.vegetation * 100}% · temperature ${RISK_WEIGHTS.heat * 100}% · rainfall forecast ${RISK_WEIGHTS.rainfall * 100}%. LOW &lt; 35 ≤ MODERATE &lt; 60 ≤ HIGH.</dd>
      <dt>Water stress</dt><dd>Soil dryness 35% · temperature 20% · low rain probability 20% · ET₀ vs forecast rain 15% · NDVI decline 10%.</dd>
      <dt>Possible crop stress</dt><dd>Low NDVI 30% · NDVI decline 30% · heat 20% · soil dryness 20%. Requires a satellite reading; always worded as “possible”.</dd>
      <dt>Climate risk</dt><dd>Dry-spell length 25% · past 30-day rainfall 20% · heat 20% · forecast rainfall extremes 20% · vegetation 15%. Rainfall uses fixed thresholds, not a long-term climatology.</dd>
      <dt>Heat risk</dt><dd>Highest forecast daily maximum within 3 days: LOW &lt; 35 °C ≤ MEDIUM &lt; 38 °C ≤ HIGH.</dd>
      <dt>Solar irrigation opportunity</dt><dd>HIGH where irrigation demand is HIGH (ET₀ deficit 50%, soil dryness 30%, heat 20%) and mean forecast radiation ≥ 5 kWh/m²/day. Suitability only — does not confirm existing pumps.</dd>
      <dt>Soil moisture</dt><dd>${e(SOIL_ASSUMPTION.note)}</dd>
      <dt>Vegetation</dt><dd>District mean of MODIS 8-day NDVI pixels (decoded from the published GIBS colormap), compared with the composite ~16 days earlier. District means mix cropland, forest and settlements.</dd>
    </dl>
  </section>`;
}

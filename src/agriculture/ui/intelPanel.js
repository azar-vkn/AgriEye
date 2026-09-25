import { escapeHtml, icon } from './icons.js';
import { fmt, forecastStrip, formatTimestamp, levelClass, meter } from './format.js';
import { FRESHNESS_LABEL, STATUS, STATUS_LABEL, describeAge } from '../model/provenance.js';
import { SOIL_ASSUMPTION } from '../data/soil/soilMoisture.js';
import { describeWeatherCode } from '../data/weather/openMeteo.js';

// Right-side intelligence panel: district analysis or state overview.
// Every figure is shown with its source freshness; missing inputs say so.

const e = escapeHtml;
const pct = (value) => (Number.isFinite(value) ? `${Math.round(value * 100)}%` : '—');

function levelChip(level, label = level) {
  return `<span class="ae-level ${levelClass(level)}">${e(level === 'INSUFFICIENT' ? 'INSUFFICIENT DATA' : label)}</span>`;
}

function row(label, meterHtml, value, detail = '') {
  return `<div class="ae-row">
    <div class="ae-row-head"><span>${e(label)}</span><strong>${value}</strong></div>
    ${meterHtml}
    ${detail ? `<div class="ae-row-detail">${detail}</div>` : ''}
  </div>`;
}

function freshnessList(sources, keys) {
  return keys
    .map(([key, label]) => {
      const d = sources[key];
      if (!d) return `<li><span class="ae-dot" data-status="empty"></span><span class="ae-fr-label">${e(label)}</span><span class="ae-fr-value">not available</span></li>`;
      const when = d.observedAt
        ? `${formatTimestamp(d.observedAt)}${describeAge(d.observedAt) ? ` · ${describeAge(d.observedAt)}` : ''}`
        : STATUS_LABEL[d.status];
      return `<li title="${e(d.product)} — ${e(d.resolution)}">
        <span class="ae-dot" data-status="${e(d.status)}"></span>
        <span class="ae-fr-label">${e(label)}</span>
        <span class="ae-fr-badge" data-fresh="${e(d.freshness)}">${e(FRESHNESS_LABEL[d.freshness])}</span>
        <span class="ae-fr-value">${e(d.source)}<br><small>${e(when)}</small></span>
      </li>`;
    })
    .join('');
}

function factorBars(result) {
  const factors = (result.factors || []).filter((f) => f.points != null).sort((a, b) => b.points - a.points);
  if (!factors.length) return '';
  const max = Math.max(1, ...factors.map((f) => f.points));
  return `<div class="ae-factors">${factors
    .map(
      (f) => `<div class="ae-factor" title="Weight ${Math.round(f.weight * 100)}% · stress ${pct(f.stress)}">
        <span class="ae-factor-label">${e(f.label)}</span>
        <span class="ae-factor-bar"><span style="width:${(f.points / max) * 100}%"></span></span>
        <span class="ae-factor-pts">${f.points.toFixed(1)}</span>
        <span class="ae-factor-value">${e(f.value || '—')}</span>
      </div>`,
    )
    .join('')}</div>`;
}

function reasonList(items, cls = '') {
  return items.length ? `<ul class="ae-reasons ${cls}">${items.map((r) => `<li>${e(r)}</li>`).join('')}</ul>` : '';
}

function indicator(label, result, key) {
  const level = result.level;
  const text = key === 'cropStress' && level !== 'INSUFFICIENT' ? result.headline : null;
  return `<details class="ae-indicator">
    <summary><span>${e(label)}</span>${levelChip(level)}${result.score != null ? `<em>${result.score}</em>` : ''}</summary>
    ${text ? `<p class="ae-muted">${e(text)}</p>` : ''}
    ${reasonList(result.reasons || [])}
    ${reasonList(result.mitigating || [], 'ae-mitigating')}
    ${result.note ? `<p class="ae-note">${e(result.note)}</p>` : ''}
    ${level === 'INSUFFICIENT' && result.missing?.length ? `<p class="ae-note">Missing: ${e(result.missing.join(', '))}</p>` : ''}
  </details>`;
}

export function renderRegionPanel(record, { demo = false } = {}) {
  const a = record.analysis;
  const risk = a.agriculturalRisk;
  const solar = a.solarOpportunity;
  const w = record.weather;
  const soil = record.soil;
  const veg = record.vegetation;
  const soilDetail = soil
    ? `${fmt(soil.volumetric, 3)} m³/m³ volumetric (model, 3–27 cm)${soil.relative === 0 ? ' · at or below the generic wilting-point bound' : ''}`
    : 'Soil moisture unavailable';
  const vegDetail = veg
    ? `District mean of ${Math.round((veg.validFraction || 0) * 100)}% cloud-free pixels · ${veg.trend || 'trend n/a'}${Number.isFinite(veg.change) ? ` (${Math.abs(veg.change) < 0.005 ? '±0.00' : `${veg.change > 0 ? '+' : ''}${veg.change.toFixed(2)}`} vs ${e(veg.previousDate || 'previous composite')})` : ''}`
    : 'Vegetation unavailable';

  return `
  <header class="ae-panel-head">
    <div>
      <div class="ae-kicker">REGION ANALYSIS${demo ? ' · <span class="ae-demo-tag">DEMO DATA</span>' : ''}</div>
      <h2>${e(record.name)}</h2>
      <div class="ae-sub">${e(record.state)} · District (Census 2011) · ${record.areaKm2?.toLocaleString('en-IN') ?? '—'} km²</div>
    </div>
    <button class="ae-icon-btn" data-action="close-panel" aria-label="Close analysis">${icon('close')}</button>
  </header>

  <section class="ae-section">
    <h3>${icon('agriculture', { size: 14 })} Agricultural status</h3>
    ${row('Vegetation (NDVI)', meter(veg ? veg.ndvi : null, 'veg'), veg ? `${fmt(veg.ndvi, 2)} · ${e(veg.band)}` : '—', vegDetail)}
    ${row('Soil moisture', meter(soil?.relative, 'soil'), soil ? `${pct(soil.relative)} · ${e(soil.band)}` : '—', soilDetail)}
    ${row('Rain probability', meter(Number.isFinite(w?.rainProbability3d) ? w.rainProbability3d / 100 : null, 'rain'), w ? fmt(w.rainProbability3d, 0, '%') : '—', w ? `Max over next 3 days · ${fmt(w.rainNext7d, 0, ' mm')} forecast over 7 days · ${fmt(w.rainPast30d, 0, ' mm')} in the past ${w.pastDaysCovered} days` : 'Weather unavailable')}
    ${row('Temperature', meter(Number.isFinite(w?.temperature) ? (w.temperature - 15) / 30 : null, 'heat'), w ? fmt(w.temperature, 1, '°C') : '—', w ? `${e(describeWeatherCode(w.weatherCode))} · humidity ${fmt(w.humidity, 0, '%')} · wind ${fmt(w.windSpeed, 0, ' km/h')} · max ${fmt(w.maxTemperature3d, 1, '°C')} within 3 days` : '')}
    ${w ? forecastStrip(w.forecast) : ''}
  </section>

  <section class="ae-section ae-risk">
    <h3>${icon('risk', { size: 14 })} Agricultural risk ${levelChip(risk.level)}${risk.score != null ? `<span class="ae-score">${risk.score}<small>/100</small></span>` : ''}</h3>
    ${risk.level === 'INSUFFICIENT' ? `<p class="ae-muted">I don't have sufficient data for this region. Missing: ${e(risk.missing.join(', '))}.</p>` : `
      ${factorBars(risk)}
      ${risk.reasons.length ? `<div class="ae-label">Contributing factors</div>${reasonList(risk.reasons)}` : ''}
      ${risk.mitigating.length ? `<div class="ae-label">Offsetting factors</div>${reasonList(risk.mitigating, 'ae-mitigating')}` : ''}
      ${risk.coverage < 1 ? `<p class="ae-note">Computed from ${Math.round(risk.coverage * 100)}% of the model's inputs (missing: ${e(risk.missing.join(', '))}).</p>` : ''}`}
    <div class="ae-indicators">
      ${indicator('Water stress', a.waterStress, 'waterStress')}
      ${indicator('Possible crop stress', a.cropStress, 'cropStress')}
      ${indicator('Heat risk', a.heatRisk, 'heatRisk')}
      ${indicator('Climate risk', a.climateRisk, 'climateRisk')}
    </div>
    <button class="ae-text-btn" data-action="ask" data-q="Why is ${e(record.name)} at risk?">Ask why ${icon('send', { size: 14 })}</button>
  </section>

  <section class="ae-section ae-solar">
    <h3>${icon('solar', { size: 14 })} Solar irrigation opportunity ${levelChip(solar.level)}</h3>
    <p>${e(solar.statement)}</p>
    <div class="ae-pair">
      <div><span>Solar potential</span><strong>${fmt(solar.solarPotential.kwhPerM2Day, 1)} <small>kWh/m²/day</small></strong>${levelChip(solar.solarPotential.level || 'INSUFFICIENT')}</div>
      <div><span>Irrigation demand</span><strong>${fmt(solar.irrigationDemand.index, 2)} <small>index</small></strong>${levelChip(solar.irrigationDemand.level || 'INSUFFICIENT')}</div>
    </div>
    <p class="ae-note">${e(solar.caveat)} Solar potential = mean forecast shortwave radiation (7 days).</p>
  </section>

  <section class="ae-section">
    <h3>${icon('info', { size: 14 })} Data freshness</h3>
    <ul class="ae-freshness">${freshnessList(record.dataSources, [
      ['Weather', 'weather'],
      ['Soil', 'soil'],
      ['Satellite', 'vegetation'],
      ['Boundaries', 'geography'],
    ].map(([label, key]) => [key, label]))}</ul>
    <p class="ae-note">Values are sampled at the district centroid (weather, soil) or averaged across the district (NDVI). ${e(SOIL_ASSUMPTION.note)}</p>
    <button class="ae-text-btn" data-action="open-sources">Sources &amp; method ${icon('info', { size: 14 })}</button>
  </section>`;
}

export function renderStatePanel(entry, summary, records, datasets, { demo = false, loading = false } = {}) {
  const assessed = records.filter((r) => r.analysis.agriculturalRisk.level !== 'INSUFFICIENT');
  const ranked = [...assessed].sort((a, b) => b.analysis.agriculturalRisk.score - a.analysis.agriculturalRisk.score);
  const sourceRows = ['weather', 'soil', 'vegetation']
    .map((key) => {
      const d = datasets[key];
      return `<li><span class="ae-dot" data-status="${e(d.status)}"></span>${e(d.label)}<em>${e(STATUS_LABEL[d.status])}</em></li>`;
    })
    .join('');
  const m = summary?.means || {};
  return `
  <header class="ae-panel-head">
    <div>
      <div class="ae-kicker">STATE OVERVIEW${demo ? ' · <span class="ae-demo-tag">DEMO DATA</span>' : ''}</div>
      <h2>${e(entry.name)}</h2>
      <div class="ae-sub">${entry.districtCount} districts (Census 2011) · ${entry.areaKm2?.toLocaleString('en-IN')} km²</div>
    </div>
    <button class="ae-icon-btn" data-action="close-panel" aria-label="Close overview">${icon('close')}</button>
  </header>
  <section class="ae-section">
    <ul class="ae-source-mini">${sourceRows}</ul>
    ${loading && !assessed.length ? '<p class="ae-muted ae-loading-line">Loading district data…</p>' : ''}
    ${assessed.length ? `
    <div class="ae-stats">
      <div><strong class="lvl-high-text">${summary.counts.riskHigh}</strong><span>High risk</span></div>
      <div><strong>${summary.counts.waterHigh}</strong><span>High water stress</span></div>
      <div><strong>${summary.counts.cropHigh}</strong><span>Possible crop stress</span></div>
      <div><strong class="lvl-solar-text">${summary.counts.solarHigh}</strong><span>Solar opportunity</span></div>
    </div>
    <div class="ae-means">
      <span>Mean NDVI <b>${fmt(m.ndvi, 2)}</b></span>
      <span>Soil <b>${pct(m.soil)}</b></span>
      <span>Temp <b>${fmt(m.temperature, 1, '°C')}</b></span>
      <span>Rain chance <b>${fmt(m.rainProbability3d, 0, '%')}</b></span>
    </div>` : ''}
  </section>
  ${ranked.length ? `
  <section class="ae-section">
    <h3>${icon('risk', { size: 14 })} Districts by agricultural risk</h3>
    <ol class="ae-rank">${ranked
      .map(
        (r) => `<li><button data-action="select-region" data-id="${e(r.id)}">
          <span class="ae-rank-name">${e(r.name)}</span>
          <span class="ae-rank-bar"><span class="${levelClass(r.analysis.agriculturalRisk.level)}" style="width:${r.analysis.agriculturalRisk.score}%"></span></span>
          <span class="ae-rank-score">${r.analysis.agriculturalRisk.score}</span>
        </button></li>`,
      )
      .join('')}</ol>
    ${records.length > assessed.length ? `<p class="ae-note">${records.length - assessed.length} districts lack enough data to score.</p>` : ''}
  </section>` : ''}`;
}

export function renderIndiaPanel(index) {
  return `
  <header class="ae-panel-head">
    <div>
      <div class="ae-kicker">NATIONAL VIEW</div>
      <h2>India</h2>
      <div class="ae-sub">${index?.states.length ?? '—'} states & UTs · ${index?.states.reduce((n, s) => n + s.districtCount, 0) ?? '—'} districts (Census 2011)</div>
    </div>
    <button class="ae-icon-btn" data-action="close-panel" aria-label="Close">${icon('close')}</button>
  </header>
  <section class="ae-section">
    <p>Select a state on the globe to load district-level weather, soil moisture and satellite vegetation data, then select a district for a full analysis.</p>
    <p class="ae-muted">District data loads on demand to keep the globe light.</p>
    <button class="ae-text-btn" data-action="ask" data-q="Show agricultural water stress in Tamil Nadu">Show water stress in Tamil Nadu ${icon('send', { size: 14 })}</button>
  </section>`;
}

export const STATUS_OK = new Set([STATUS.AVAILABLE, STATUS.DEMO]);

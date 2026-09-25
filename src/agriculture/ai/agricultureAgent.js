import { findPlaces, normalize } from './places.js';
import { FRESHNESS_LABEL, STATUS } from '../model/provenance.js';
import { LEVEL_RANK } from '../analysis/index.js';
import { unionBBox } from '../geo.js';

// AgriEye's agriculture agent. It parses a question into an intent, reads
// ONLY the region records currently loaded in the data store, and returns an
// answer with the map actions that illustrate it. It never estimates a value
// it does not have; missing inputs produce an explicit "insufficient data".

const INSUFFICIENT = "I don't have sufficient data for this region.";
const fmt = (value, digits = 0, unit = '') =>
  Number.isFinite(value) ? `${value.toFixed(digits)}${unit}` : '—';
const pct = (value) => (Number.isFinite(value) ? `${Math.round(value * 100)}%` : '—');
const list = (items) =>
  items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;

const HIGH_WORDS = /\b(high|higher|highest|severe|most|worst|elevated|strong|significant)\b/;
const LOW_WORDS = /\b(low|lower|lowest|poor|weak|least|dry|drier|driest)\b/;
const MODERATE_WORDS = /\b(moderate|medium)\b/;
const GOOD_WORDS = /\b(good|healthy|wet|adequate|favourable|favorable)\b/;

/** Metrics the agent can filter and explain. */
const METRICS = {
  waterStress: {
    label: 'water stress',
    pattern: /water[\s-]*stress|drought|water shortage|water scarcity/,
    layer: ['risk', 'waterStress'],
    level: (r) => r.analysis.waterStress.level,
    severity: (r) => r.analysis.waterStress.score,
    value: (r) => `${r.analysis.waterStress.level} (${r.analysis.waterStress.score}/100)`,
    defaultLevels: ['HIGH'],
    sources: ['weather', 'soil', 'vegetation'],
  },
  cropStress: {
    label: 'possible crop stress',
    pattern: /crop[\s-]*(stress|health|condition)|stressed crops?/,
    layer: ['risk', 'cropStress'],
    level: (r) => r.analysis.cropStress.level,
    severity: (r) => r.analysis.cropStress.score,
    value: (r) => `${r.analysis.cropStress.level} (${r.analysis.cropStress.score}/100)`,
    defaultLevels: ['HIGH'],
    sources: ['vegetation', 'weather', 'soil'],
  },
  climateRisk: {
    label: 'climate risk',
    pattern: /climate/,
    layer: ['risk', 'climateRisk'],
    level: (r) => (r.analysis.climateRisk.level === 'MEDIUM' ? 'MODERATE' : r.analysis.climateRisk.level),
    severity: (r) => r.analysis.climateRisk.score,
    value: (r) => `${r.analysis.climateRisk.level} (${r.analysis.climateRisk.score}/100)`,
    defaultLevels: ['HIGH'],
    sources: ['weather', 'vegetation'],
  },
  solar: {
    label: 'solar-irrigation opportunity',
    pattern: /solar|sunlight|irradiance|\bpv\b/,
    layer: ['solar'],
    level: (r) => r.analysis.solarOpportunity.level,
    severity: (r) => r.analysis.solarOpportunity.irrigationDemand.index * 100 + (r.solar?.radiationKwh ?? 0),
    value: (r) => {
      const s = r.analysis.solarOpportunity;
      return `${s.level} — ${fmt(s.solarPotential.kwhPerM2Day, 1)} kWh/m²/day, irrigation demand ${s.irrigationDemand.level || '—'}`;
    },
    defaultLevels: ['HIGH'],
    sources: ['weather', 'soil'],
  },
  irrigation: {
    label: 'irrigation demand',
    pattern: /irrigation|water demand/,
    layer: ['solar'],
    level: (r) => r.analysis.solarOpportunity.irrigationDemand.level || 'INSUFFICIENT',
    severity: (r) => r.analysis.solarOpportunity.irrigationDemand.index * 100,
    value: (r) => `${r.analysis.solarOpportunity.irrigationDemand.level || '—'} (index ${fmt(r.analysis.solarOpportunity.irrigationDemand.index, 2)})`,
    defaultLevels: ['HIGH'],
    sources: ['weather', 'soil'],
  },
  soil: {
    label: 'soil moisture',
    pattern: /soil|moisture/,
    layer: ['soil'],
    level: (r) => r.soil?.band || 'INSUFFICIENT',
    severity: (r) => (r.soil ? (1 - r.soil.relative) * 100 : null),
    value: (r) => (r.soil ? `${pct(r.soil.relative)} relative (${r.soil.band})` : '—'),
    defaultLevels: null,
    lowIsBad: true,
    sources: ['soil'],
  },
  vegetation: {
    label: 'vegetation condition',
    pattern: /vegetation|ndvi|greenness|green cover|crop cover/,
    layer: ['vegetation'],
    level: (r) => r.vegetation?.band || 'INSUFFICIENT',
    severity: (r) => (r.vegetation ? (1 - r.vegetation.ndvi) * 100 : null),
    value: (r) => (r.vegetation ? `NDVI ${fmt(r.vegetation.ndvi, 2)} (${r.vegetation.band}${r.vegetation.trend ? `, ${r.vegetation.trend}` : ''})` : '—'),
    defaultLevels: null,
    lowIsBad: true,
    sources: ['vegetation'],
  },
  rain: {
    label: 'expected rainfall',
    pattern: /rain|rainfall|precipitation|shower|monsoon|wet weather/,
    layer: ['weather'],
    level: (r) => {
      const p = r.weather?.rainProbability3d;
      if (!Number.isFinite(p)) return 'INSUFFICIENT';
      return p >= 60 || r.weather.rainNext7d >= 20 ? 'HIGH' : p >= 30 ? 'MODERATE' : 'LOW';
    },
    severity: (r) => r.weather?.rainProbability3d ?? null,
    value: (r) =>
      r.weather ? `${fmt(r.weather.rainProbability3d, 0, '%')} chance (3 days), ${fmt(r.weather.rainNext7d, 0, ' mm')} forecast over 7 days` : '—',
    defaultLevels: ['HIGH'],
    sources: ['weather'],
  },
  heat: {
    label: 'heat risk',
    pattern: /heat|hot|temperature|warm/,
    layer: ['heat'],
    level: (r) => (r.analysis.heatRisk.level === 'MEDIUM' ? 'MODERATE' : r.analysis.heatRisk.level),
    severity: (r) => r.weather?.maxTemperature3d ?? null,
    value: (r) => `${r.analysis.heatRisk.level} — max ${fmt(r.weather?.maxTemperature3d, 1, '°C')} within 3 days`,
    defaultLevels: ['HIGH'],
    sources: ['weather'],
  },
  agriculturalRisk: {
    label: 'agricultural risk',
    pattern: /\brisk|\bat risk|danger|threat/,
    layer: ['risk', 'agriculturalRisk'],
    level: (r) => r.analysis.agriculturalRisk.level,
    severity: (r) => r.analysis.agriculturalRisk.score,
    value: (r) => `${r.analysis.agriculturalRisk.level} (${r.analysis.agriculturalRisk.score}/100)`,
    defaultLevels: ['HIGH'],
    sources: ['weather', 'soil', 'vegetation'],
  },
};
const METRIC_ORDER = ['waterStress', 'cropStress', 'climateRisk', 'solar', 'irrigation', 'soil', 'vegetation', 'rain', 'heat', 'agriculturalRisk'];

function detectMetric(text) {
  return METRIC_ORDER.find((key) => METRICS[key].pattern.test(text)) || null;
}

function wantedLevels(metricKey, text) {
  const metric = METRICS[metricKey];
  if (metricKey === 'rain' && /\b(expected|forecast|likely|where will|coming|predicted)\b/.test(text)) return ['HIGH'];
  if (metric.lowIsBad) {
    if (LOW_WORDS.test(text)) return ['LOW'];
    if (MODERATE_WORDS.test(text)) return ['MODERATE'];
    if (GOOD_WORDS.test(text) || HIGH_WORDS.test(text))
      return [metricKey === 'soil' ? 'GOOD' : 'HEALTHY'];
    return null;
  }
  if (LOW_WORDS.test(text) && !/\blow(er)? (soil|rain)/.test(text)) return ['LOW'];
  if (MODERATE_WORDS.test(text)) return ['MODERATE'];
  if (HIGH_WORDS.test(text)) return ['HIGH'];
  return metric.defaultLevels;
}

/** One-line provenance for the datasets an answer used. */
function sourceLine(datasets, keys) {
  const parts = [];
  for (const key of keys) {
    const d = datasets[key];
    if (!d) continue;
    const when =
      d.status === STATUS.AVAILABLE || d.status === STATUS.STALE || d.status === STATUS.DEMO
        ? d.observedAt
          ? ` · ${String(d.observedAt).replace('T', ' ').slice(0, 16)}`
          : ''
        : ` · ${d.status}`;
    parts.push(`${d.source} [${FRESHNESS_LABEL[d.freshness]}]${when}`);
  }
  return parts.join('; ');
}

/**
 * @param {object} deps
 * @param {object} deps.store         AgriEye data store.
 * @param {() => Array} deps.getPlaces Place index for name resolution.
 * @param {() => {regionId:string|null, stateId:string|null}} deps.getSelection
 */
export function createAgricultureAgent({ store, getPlaces, getSelection }) {
  async function ensureState(stateId) {
    await store.loadState(stateId).catch(() => null);
    return store.getStateRecords(stateId);
  }

  function reply(text, { actions = [], sourceKeys = [], stateId = null, suggestions = [], status = 'ok' } = {}) {
    const datasets = store.getDatasets(stateId || undefined);
    const demo = store.getMode() === 'demo';
    return {
      text,
      actions,
      status,
      suggestions,
      sources: sourceKeys.length ? sourceLine(datasets, sourceKeys) : '',
      demo,
    };
  }

  async function scopeRecords(places, text) {
    const statePlace = places.find((p) => p.place.kind === 'state')?.place;
    const selection = getSelection();
    if (statePlace) return { stateId: statePlace.id, stateName: statePlace.name, records: await ensureState(statePlace.id) };
    if (/\b(india|all states|country|nationwide)\b/.test(text) && store.getLoadedStateIds().length)
      return { stateId: null, stateName: 'the loaded states', records: store.getLoadedRecords() };
    const stateId = selection.stateId || store.getFocusedStateId();
    if (stateId) {
      const entry = store.getIndex()?.states.find((s) => s.id === stateId);
      return { stateId, stateName: entry?.name || stateId, records: await ensureState(stateId) };
    }
    const loaded = store.getLoadedRecords();
    return { stateId: null, stateName: 'the loaded states', records: loaded };
  }

  async function regionFrom(places) {
    const district = places.find((p) => p.place.kind === 'district');
    if (district) {
      await ensureState(district.place.stateId);
      return { record: store.getRecord(district.place.id), note: district.note };
    }
    const selected = getSelection().regionId;
    return { record: selected ? store.getRecord(selected) : null, note: null };
  }

  async function filterMetric(metricKey, text, places) {
    const metric = METRICS[metricKey];
    const scope = await scopeRecords(places, text);
    const [layer, variant] = metric.layer;
    const actions = [{ type: 'layer', id: layer, variant }];
    if (scope.stateId) actions.push({ type: 'fly', stateId: scope.stateId });
    if (!scope.records.length) {
      return reply(
        'No district data is loaded yet. Open a state first — for example "Show Tamil Nadu".',
        { actions, status: 'insufficient', suggestions: ['Show Tamil Nadu'] },
      );
    }
    const assessed = scope.records.filter((r) => metric.level(r) !== 'INSUFFICIENT');
    const missing = scope.records.length - assessed.length;
    if (!assessed.length)
      return reply(`I don't have sufficient data to assess ${metric.label} in ${scope.stateName}.`, {
        actions,
        sourceKeys: metric.sources,
        stateId: scope.stateId,
        status: 'insufficient',
      });

    const counts = {};
    for (const r of assessed) counts[metric.level(r)] = (counts[metric.level(r)] || 0) + 1;
    const distribution = Object.entries(counts)
      .sort(([a], [b]) => (LEVEL_RANK[b] ?? 0) - (LEVEL_RANK[a] ?? 0))
      .map(([level, n]) => `${n} ${level}`)
      .join(' · ');

    let levels = wantedLevels(metricKey, text);
    let matches = levels ? assessed.filter((r) => levels.includes(metric.level(r))) : [];
    let fallbackNote = '';
    if (levels?.includes('HIGH') && !matches.length) {
      matches = assessed.filter((r) => metric.level(r) === 'MODERATE');
      if (matches.length) fallbackNote = ` No district reaches HIGH; showing the ${matches.length} at MODERATE.`;
      levels = ['MODERATE'];
    }
    const sorted = [...matches].sort((a, b) =>
      metric.lowIsBad && levels?.some((l) => l === 'GOOD' || l === 'HEALTHY')
        ? (metric.severity(a) ?? 0) - (metric.severity(b) ?? 0)
        : (metric.severity(b) ?? -1) - (metric.severity(a) ?? -1),
    );
    if (levels) actions.push({ type: 'highlight', ids: sorted.map((r) => r.id) });
    else actions.push({ type: 'clearHighlight' });

    const lines = [];
    if (!levels) {
      const ranked = [...assessed].sort((a, b) => (metric.severity(b) ?? -1) - (metric.severity(a) ?? -1));
      lines.push(`${capitalize(metric.label)} across ${scope.stateName}: ${distribution}.`);
      lines.push(`Most constrained: ${ranked.slice(0, 3).map((r) => `${r.name} — ${metric.value(r)}`).join('; ')}.`);
    } else if (!sorted.length) {
      lines.push(`No district in ${scope.stateName} currently matches ${levels.join('/')} ${metric.label}. Distribution: ${distribution}.`);
    } else {
      lines.push(
        `${sorted.length} of ${assessed.length} districts in ${scope.stateName} show ${levels.join('/')} ${metric.label}.${fallbackNote}`,
      );
      lines.push(
        sorted
          .slice(0, 5)
          .map((r) => `• ${r.name}: ${metric.value(r)}`)
          .join('\n'),
      );
      if (sorted.length > 5) lines.push(`…and ${sorted.length - 5} more highlighted on the map.`);
      if (metricKey === 'solar')
        lines.push('Solar-irrigation opportunity indicates suitability only; it does not confirm existing solar pumps.');
      if (metricKey === 'cropStress')
        lines.push('Remote sensing indicates possible stress; field verification is needed to confirm crop condition.');
    }
    if (missing) lines.push(`${missing} district${missing > 1 ? 's' : ''} lack the data needed for this assessment.`);
    return reply(lines.join('\n'), {
      actions,
      sourceKeys: metric.sources,
      stateId: scope.stateId,
      suggestions: sorted[0] ? [`Why is ${sorted[0].name} at risk?`, `Compare ${sorted[0].name} and ${sorted.at(-1)?.name === sorted[0].name ? 'Madurai' : sorted.at(-1).name}`] : [],
    });
  }

  function explainRecord(record, note) {
    const risk = record.analysis.agriculturalRisk;
    if (risk.level === 'INSUFFICIENT') return reply(INSUFFICIENT, { status: 'insufficient', actions: [{ type: 'select', regionId: record.id }] });
    const a = record.analysis;
    const lines = [];
    if (note) lines.push(`(${note}.)`);
    const top = risk.factors
      .filter((f) => f.points != null)
      .sort((x, y) => y.points - x.points);
    if (risk.level === 'LOW') {
      lines.push(`${record.name} is not currently rated at elevated risk: agricultural risk is LOW (${risk.score}/100).`);
      if (risk.mitigating.length) lines.push(`Supporting conditions:\n${risk.mitigating.map((m) => `• ${m}`).join('\n')}`);
    } else {
      lines.push(`${record.name} is rated ${risk.level} agricultural risk (${risk.score}/100).`);
      const drivers = risk.reasons.length ? risk.reasons : top.slice(0, 2).map((f) => `${f.label}: ${f.value}`);
      lines.push(`Contributing factors:\n${drivers.map((r) => `• ${r}`).join('\n')}`);
      if (risk.mitigating.length) lines.push(`Offsetting:\n${risk.mitigating.map((m) => `• ${m}`).join('\n')}`);
    }
    lines.push(
      `Score breakdown: ${top.map((f) => `${f.label} ${f.points} pts`).join(' · ')}.`,
    );
    lines.push(
      `Related indicators: water stress ${a.waterStress.level}${a.waterStress.score != null ? ` (${a.waterStress.score})` : ''}, ` +
        `crop stress ${a.cropStress.level === 'INSUFFICIENT' ? 'not assessed' : a.cropStress.level} , heat ${a.heatRisk.level}, climate risk ${a.climateRisk.level}.`.replace(' ,', ','),
    );
    return reply(lines.join('\n'), {
      actions: [{ type: 'select', regionId: record.id }, { type: 'layer', id: 'risk', variant: 'agriculturalRisk' }],
      sourceKeys: ['weather', 'soil', 'vegetation'],
      stateId: record.stateId,
      suggestions: ['What are the main agricultural risks in this region?', 'Show areas where high irrigation demand overlaps with high solar potential'],
    });
  }

  function mainRisks(record) {
    const a = record.analysis;
    if (a.agriculturalRisk.level === 'INSUFFICIENT') return reply(INSUFFICIENT, { status: 'insufficient' });
    const entries = [
      ['Agricultural risk', a.agriculturalRisk],
      ['Water stress', a.waterStress],
      ['Crop stress (possible)', a.cropStress],
      ['Heat', a.heatRisk],
      ['Climate risk', a.climateRisk],
    ].sort(([, x], [, y]) => (y.score ?? -1) - (x.score ?? -1));
    const lines = [`Main agricultural risks in ${record.name}, ${record.state}:`];
    for (const [label, result] of entries) {
      if (result.level === 'INSUFFICIENT') {
        lines.push(`• ${label}: insufficient data`);
        continue;
      }
      lines.push(`• ${label}: ${result.level}${result.score != null ? ` (${result.score})` : ''}${result.reasons?.[0] ? ` — ${result.reasons[0]}` : ''}`);
    }
    const s = a.solarOpportunity;
    lines.push(`Opportunity: solar-irrigation ${s.level} — ${s.statement}`);
    return reply(lines.join('\n'), {
      actions: [{ type: 'select', regionId: record.id }],
      sourceKeys: ['weather', 'soil', 'vegetation'],
      stateId: record.stateId,
      suggestions: [`Why is ${record.name} at risk?`],
    });
  }

  function stateOverview(stateId, stateName) {
    const summary = store.getStateSummary(stateId);
    const records = store.getStateRecords(stateId);
    const assessed = records.filter((r) => r.analysis.agriculturalRisk.level !== 'INSUFFICIENT');
    if (!summary || !assessed.length)
      return reply(`I don't have sufficient data for ${stateName} yet.`, {
        actions: [{ type: 'fly', stateId }],
        status: 'insufficient',
      });
    const top = [...assessed].sort((a, b) => b.analysis.agriculturalRisk.score - a.analysis.agriculturalRisk.score).slice(0, 3);
    return reply(
      [
        `${stateName}: ${assessed.length} districts assessed. Agricultural risk — ${summary.counts.riskHigh} HIGH, ${summary.counts.riskModerate} MODERATE.`,
        `Water stress HIGH in ${summary.counts.waterHigh}; possible crop stress HIGH in ${summary.counts.cropHigh}; heat HIGH in ${summary.counts.heatHigh}; solar-irrigation opportunity HIGH in ${summary.counts.solarHigh}.`,
        `Highest risk: ${top.map((r) => `${r.name} (${r.analysis.agriculturalRisk.score})`).join(', ')}.`,
      ].join('\n'),
      {
        actions: [{ type: 'fly', stateId }, { type: 'layer', id: 'risk', variant: 'agriculturalRisk' }, { type: 'highlight', ids: top.map((r) => r.id) }],
        sourceKeys: ['weather', 'soil', 'vegetation'],
        stateId,
        suggestions: top[0] ? [`Why is ${top[0].name} at risk?`] : [],
      },
    );
  }

  function compare(records) {
    const [a, b] = records;
    if (!a || !b) return reply('Name two districts to compare, e.g. "Compare Tirunelveli and Madurai".', { status: 'unknown' });
    const missing = [a, b].filter((r) => r.analysis.agriculturalRisk.level === 'INSUFFICIENT');
    if (missing.length)
      return reply(`I don't have sufficient data for ${list(missing.map((r) => r.name))}.`, { status: 'insufficient' });
    const row = (label, get) => `• ${label}: ${a.name} ${get(a)} | ${b.name} ${get(b)}`;
    const lines = [
      `${a.name} vs ${b.name}`,
      row('Agricultural risk', (r) => `${r.analysis.agriculturalRisk.level} ${r.analysis.agriculturalRisk.score}`),
      row('Water stress', (r) => `${r.analysis.waterStress.level} ${r.analysis.waterStress.score ?? ''}`.trim()),
      row('Soil moisture', (r) => (r.soil ? pct(r.soil.relative) : '—')),
      row('NDVI', (r) => (r.vegetation ? fmt(r.vegetation.ndvi, 2) : '—')),
      row('Max temp (3 d)', (r) => fmt(r.weather?.maxTemperature3d, 1, '°C')),
      row('Rain chance (3 d)', (r) => fmt(r.weather?.rainProbability3d, 0, '%')),
      row('Solar opportunity', (r) => r.analysis.solarOpportunity.level),
    ];
    const [higher, lower] =
      a.analysis.agriculturalRisk.score >= b.analysis.agriculturalRisk.score ? [a, b] : [b, a];
    const gap = higher.analysis.agriculturalRisk.score - lower.analysis.agriculturalRisk.score;
    if (gap < 5) lines.push(`Overall risk is similar (${gap} points apart).`);
    else {
      const byFactor = higher.analysis.agriculturalRisk.factors
        .map((f) => {
          const other = lower.analysis.agriculturalRisk.factors.find((g) => g.key === f.key);
          return { label: f.label, delta: (f.points ?? 0) - (other?.points ?? 0) };
        })
        .sort((x, y) => y.delta - x.delta);
      lines.push(`${higher.name} carries higher risk by ${gap} points, driven mainly by ${byFactor[0].label.toLowerCase()}.`);
    }
    return reply(lines.join('\n'), {
      actions: [
        { type: 'layer', id: 'risk', variant: 'agriculturalRisk' },
        { type: 'highlight', ids: [a.id, b.id] },
        { type: 'fly', bbox: unionBBox([a.bbox, b.bbox]) },
      ],
      sourceKeys: ['weather', 'soil', 'vegetation'],
      stateId: a.stateId,
      suggestions: [`Why is ${higher.name} at risk?`],
    });
  }

  const LAYER_WORDS = {
    agriculture: /agricultur(e|al) (layer|regions?)|farm(land)? layer/,
  };

  return Object.freeze({
    async ask(question) {
      const raw = String(question || '').trim();
      const text = normalize(raw);
      if (!text) return reply('Ask about water stress, soil moisture, vegetation, rainfall, heat, solar opportunity or risk.', { status: 'unknown' });
      const places = findPlaces(getPlaces(), raw);
      const districts = places.filter((p) => p.place.kind === 'district');

      if (/\b(demo mode|demo data|use demo|switch to demo)\b/.test(text))
        return reply('Switching to the labelled demo dataset (archived open-data snapshot).', { actions: [{ type: 'mode', mode: 'demo' }] });
      if (/\b(live mode|live data|switch to live)\b/.test(text))
        return reply('Switching back to live open-data sources.', { actions: [{ type: 'mode', mode: 'live' }] });

      if (/\b(compare|versus|vs|difference between)\b/.test(text)) {
        const records = [];
        for (const hit of districts.slice(0, 2)) {
          await ensureState(hit.place.stateId);
          const record = store.getRecord(hit.place.id);
          if (record) records.push(record);
        }
        if (records.length < 2 && getSelection().regionId && districts.length === 1) {
          const selected = store.getRecord(getSelection().regionId);
          if (selected && selected.id !== records[0]?.id) records.unshift(selected);
        }
        return compare(records);
      }

      if (/\b(why|explain|reason|reasons|cause|causes|because)\b/.test(text)) {
        const { record, note } = await regionFrom(places);
        if (!record) {
          const statePlace = places.find((p) => p.place.kind === 'state')?.place;
          if (statePlace) {
            await ensureState(statePlace.id);
            return stateOverview(statePlace.id, statePlace.name);
          }
          return reply('Select a district on the map (or name one) and ask again.', { status: 'unknown' });
        }
        return explainRecord(record, note);
      }

      if (/\b(main|key|biggest|top|major) (agricultural )?(risks?|threats?|concerns?)\b|\brisk profile\b|\bwhat are the (agricultural )?risks\b|\bsummar/.test(text)) {
        const { record } = await regionFrom(places);
        if (record) return mainRisks(record);
        const statePlace = places.find((p) => p.place.kind === 'state')?.place;
        const stateId = statePlace?.id || getSelection().stateId || store.getFocusedStateId();
        if (stateId) {
          await ensureState(stateId);
          const name = store.getIndex()?.states.find((s) => s.id === stateId)?.name || stateId;
          return stateOverview(stateId, name);
        }
        return reply('Select a region first, or name one.', { status: 'unknown' });
      }

      if (/\bsolar\b/.test(text) && /\b(irrigation|water demand|demand|pump|overlap)\b/.test(text))
        return filterMetric('solar', `${text} high`, places);

      const metricKey = detectMetric(text);
      if (metricKey) {
        // A named district with a metric → describe that district.
        if (districts.length === 1 && !/\b(which|where|regions|districts|areas)\b/.test(text)) {
          const { record, note } = await regionFrom(districts);
          if (!record) return reply(INSUFFICIENT, { status: 'insufficient' });
          const metric = METRICS[metricKey];
          if (metric.level(record) === 'INSUFFICIENT')
            return reply(INSUFFICIENT, { status: 'insufficient', actions: [{ type: 'select', regionId: record.id }] });
          return reply(`${note ? `(${note}.) ` : ''}${record.name}: ${metric.label} — ${metric.value(record)}.`, {
            actions: [{ type: 'layer', id: metric.layer[0], variant: metric.layer[1] }, { type: 'select', regionId: record.id }],
            sourceKeys: metric.sources,
            stateId: record.stateId,
            suggestions: [`Why is ${record.name} at risk?`],
          });
        }
        return filterMetric(metricKey, text, places);
      }

      if (LAYER_WORDS.agriculture.test(text))
        return reply('Showing agricultural district regions. Select a district to analyse it.', { actions: [{ type: 'layer', id: 'agriculture' }] });

      if (/\b(reset|home|whole india|all india|india view)\b/.test(text) || (places[0]?.place.kind === 'country' && places.length === 1))
        return reply('Flying to India. Select a state to load district-level analysis.', { actions: [{ type: 'fly', target: 'india' }, { type: 'deselect' }] });

      if (places.length) {
        const target = places.find((p) => p.place.kind === 'district') || places.find((p) => p.place.kind === 'state');
        if (target?.place.kind === 'district') {
          const { record, note } = await regionFrom([target]);
          if (!record) return reply(INSUFFICIENT, { status: 'insufficient' });
          const risk = record.analysis.agriculturalRisk;
          return reply(
            `${note ? `(${note}.) ` : ''}${record.name}, ${record.state}. Agricultural risk: ${risk.level === 'INSUFFICIENT' ? 'insufficient data' : `${risk.level} (${risk.score}/100)`}.`,
            {
              actions: [{ type: 'select', regionId: record.id }],
              sourceKeys: ['weather', 'soil', 'vegetation'],
              stateId: record.stateId,
              suggestions: [`Why is ${record.name} at risk?`, `What are the main agricultural risks in ${record.name}?`],
            },
          );
        }
        if (target?.place.kind === 'state') {
          await ensureState(target.place.id);
          return stateOverview(target.place.id, target.place.name);
        }
      }

      return reply(
        'I can map and explain agricultural conditions from the loaded open data. Try one of these:',
        {
          status: 'unknown',
          suggestions: [
            'Show agricultural water stress in Tamil Nadu',
            'Which regions have low soil moisture?',
            'Where is rainfall expected?',
            'Show areas where high irrigation demand overlaps with high solar potential',
            'Compare Tirunelveli and Madurai',
          ],
        },
      );
    },
  });
}

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

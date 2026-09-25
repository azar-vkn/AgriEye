import { escapeHtml } from './icons.js';

export const fmt = (value, digits = 0, unit = '') =>
  Number.isFinite(value) ? `${value.toFixed(digits)}${unit}` : '—';

const dateOnly = /^\d{4}-\d{2}-\d{2}$/;

/** "25 Sep 2026, 10:30 IST" (or date only for daily products). */
export function formatTimestamp(iso) {
  if (!iso) return '—';
  if (dateOnly.test(iso)) {
    const date = new Date(`${iso}T00:00:00Z`);
    return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  }
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return escapeHtml(iso);
  return `${at.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Kolkata',
  })} IST`;
}

export const levelClass = (level) =>
  ({
    HIGH: 'lvl-high',
    MODERATE: 'lvl-mod',
    MEDIUM: 'lvl-mod',
    LOW: 'lvl-low',
    GOOD: 'lvl-good',
    HEALTHY: 'lvl-good',
    INSUFFICIENT: 'lvl-none',
  })[level] || 'lvl-none';

/** Horizontal meter, value 0..1. */
export function meter(value, tone = 'accent') {
  const width = Number.isFinite(value) ? Math.round(Math.max(0, Math.min(1, value)) * 100) : 0;
  return `<span class="ae-meter" data-tone="${tone}"><span style="width:${width}%"></span></span>`;
}

/** Seven-day forecast strip: rain bars with max-temperature ticks. */
export function forecastStrip(forecast = []) {
  if (!forecast.length) return '';
  const maxRain = Math.max(10, ...forecast.map((d) => d.rain || 0));
  const temps = forecast.map((d) => d.tMax).filter(Number.isFinite);
  const [tLow, tHigh] = [Math.min(...temps) - 1, Math.max(...temps) + 1];
  const cells = forecast
    .map((day) => {
      const rain = Number.isFinite(day.rain) ? Math.max(2, (day.rain / maxRain) * 100) : 0;
      const t = Number.isFinite(day.tMax) ? ((day.tMax - tLow) / Math.max(1, tHigh - tLow)) * 100 : null;
      const weekday = new Date(`${day.date}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' });
      return `<div class="ae-fc-day" title="${escapeHtml(day.date)}: max ${fmt(day.tMax, 1, '°C')}, rain ${fmt(day.rain, 1, ' mm')} (${fmt(day.rainProbability, 0, '%')})">
        <div class="ae-fc-plot">
          <span class="ae-fc-rain" style="height:${rain}%"></span>
          ${t == null ? '' : `<span class="ae-fc-temp" style="bottom:${t}%"></span>`}
        </div>
        <span class="ae-fc-label">${weekday.slice(0, 2)}</span>
        <span class="ae-fc-value">${fmt(day.tMax, 0, '°')}</span>
      </div>`;
    })
    .join('');
  return `<div class="ae-forecast">${cells}</div>
    <div class="ae-forecast-key"><span><i class="k-rain"></i>rain (mm)</span><span><i class="k-temp"></i>max temp</span></div>`;
}

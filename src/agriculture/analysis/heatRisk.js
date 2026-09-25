/**
 * Heat risk from the highest forecast daily maximum over the next 3 days.
 * LOW below 35 °C, MEDIUM from 35 °C, HIGH from 38 °C — common thresholds
 * above which many field crops show heat stress during flowering.
 */
export function assessHeatRisk(record) {
  const t = record.weather?.maxTemperature3d;
  if (!Number.isFinite(t))
    return { level: 'INSUFFICIENT', score: null, reasons: [], mitigating: [], factors: [] };
  const level = t >= 38 ? 'HIGH' : t >= 35 ? 'MEDIUM' : 'LOW';
  const score = Math.round(Math.max(0, Math.min(1, (t - 30) / 12)) * 100);
  const text = `Forecast maximum ${t.toFixed(1)}°C within 3 days`;
  return {
    level,
    score,
    reasons: level === 'LOW' ? [] : [`${text} (≥ ${level === 'HIGH' ? 38 : 35}°C)`],
    mitigating: level === 'LOW' ? [`${text} (below 35°C)`] : [],
    factors: [{ key: 'heat', label: 'Max temperature (3 days)', value: `${t.toFixed(1)}°C`, stress: score / 100, weight: 1, points: score }],
  };
}

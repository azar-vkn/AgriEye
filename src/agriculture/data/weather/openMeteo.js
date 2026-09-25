import { cached, fetchJson } from '../http.js';

// One Open-Meteo request covers every district centroid in a state: current
// conditions, model soil moisture, 30 past days and a 7-day forecast.
// Free, keyless, CORS-enabled: https://open-meteo.com/en/docs
const ENDPOINT = 'https://api.open-meteo.com/v1/forecast';
const TTL_MS = 30 * 60_000;
const MAX_LOCATIONS_PER_REQUEST = 50;
const IST_OFFSET = '+05:30';

const CURRENT = [
  'temperature_2m',
  'relative_humidity_2m',
  'precipitation',
  'wind_speed_10m',
  'weather_code',
  'soil_moisture_3_to_9cm',
  'soil_moisture_9_to_27cm',
];
const DAILY = [
  'temperature_2m_max',
  'temperature_2m_min',
  'precipitation_sum',
  'precipitation_probability_max',
  'shortwave_radiation_sum',
  'et0_fao_evapotranspiration',
];

export function buildOpenMeteoUrl(points, { endpoint = ENDPOINT } = {}) {
  const params = new URLSearchParams({
    latitude: points.map(([, lat]) => lat.toFixed(3)).join(','),
    longitude: points.map(([lon]) => lon.toFixed(3)).join(','),
    current: CURRENT.join(','),
    daily: DAILY.join(','),
    past_days: '30',
    forecast_days: '7',
    timezone: 'Asia/Kolkata',
  });
  return `${endpoint}?${params}`;
}

const finite = (value) => (Number.isFinite(value) ? value : null);
const sum = (values) => {
  const valid = values.filter(Number.isFinite);
  return valid.length ? valid.reduce((a, b) => a + b, 0) : null;
};
const mean = (values) => {
  const valid = values.filter(Number.isFinite);
  return valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
};
const max = (values) => {
  const valid = values.filter(Number.isFinite);
  return valid.length ? Math.max(...valid) : null;
};
const round = (value, digits = 1) =>
  value == null ? null : Math.round(value * 10 ** digits) / 10 ** digits;

/** Reduce one Open-Meteo location payload to AgriEye's weather/soil inputs. */
export function normalizeOpenMeteoLocation(payload) {
  const current = payload?.current;
  const daily = payload?.daily;
  if (!current || !daily?.time?.length) return null;
  const today = String(current.time).slice(0, 10);
  let t = daily.time.indexOf(today);
  if (t < 0) t = Math.min(30, daily.time.length - 1);
  const slice = (key, from, to) => (daily[key] || []).slice(from, to);

  const pastRain = slice('precipitation_sum', Math.max(0, t - 30), t);
  let dryDays = 0;
  for (let i = t - 1; i >= 0; i -= 1) {
    const rain = daily.precipitation_sum?.[i];
    if (!Number.isFinite(rain) || rain >= 1) break;
    dryDays += 1;
  }
  const next7 = (key) => slice(key, t, t + 7);
  const soilLayers = [
    finite(current.soil_moisture_3_to_9cm),
    finite(current.soil_moisture_9_to_27cm),
  ];
  const radiation = mean(next7('shortwave_radiation_sum'));

  return {
    observedAt: `${current.time}${IST_OFFSET}`,
    grid: {
      latitude: finite(payload.latitude),
      longitude: finite(payload.longitude),
      elevation: finite(payload.elevation),
    },
    weather: {
      temperature: finite(current.temperature_2m),
      humidity: finite(current.relative_humidity_2m),
      precipitationNow: finite(current.precipitation),
      windSpeed: finite(current.wind_speed_10m),
      weatherCode: finite(current.weather_code),
      maxTemperature3d: round(max(slice('temperature_2m_max', t, t + 3))),
      meanMaxTemperature7d: round(mean(next7('temperature_2m_max'))),
      rainProbability3d: finite(max(slice('precipitation_probability_max', t, t + 3))),
      rainNext7d: round(sum(next7('precipitation_sum'))),
      rainPast30d: round(sum(pastRain)),
      pastDaysCovered: pastRain.length,
      dryDays,
      et0Next7d: round(sum(next7('et0_fao_evapotranspiration'))),
      forecast: daily.time.slice(t, t + 7).map((date, i) => ({
        date,
        tMax: finite(daily.temperature_2m_max?.[t + i]),
        tMin: finite(daily.temperature_2m_min?.[t + i]),
        rain: finite(daily.precipitation_sum?.[t + i]),
        rainProbability: finite(daily.precipitation_probability_max?.[t + i]),
      })),
    },
    soil: {
      volumetric: round(mean(soilLayers), 3),
      layers: { '3-9cm': soilLayers[0], '9-27cm': soilLayers[1] },
    },
    solar: {
      // MJ/m²/day → kWh/m²/day
      radiationKwh: radiation == null ? null : round(radiation / 3.6, 2),
    },
  };
}

/**
 * Fetch weather, soil and radiation inputs for [lon, lat] points.
 * @returns {Promise<{results: Array<object|null>, fetchedAt: number, stale: boolean}>}
 */
export async function fetchOpenMeteo(points, { signal, cacheKey, bypassCache = false } = {}) {
  const batches = [];
  for (let i = 0; i < points.length; i += MAX_LOCATIONS_PER_REQUEST)
    batches.push(points.slice(i, i + MAX_LOCATIONS_PER_REQUEST));
  const outcomes = await Promise.all(
    batches.map((batch, index) =>
      cached(`open-meteo:${cacheKey || 'adhoc'}:${index}:${batch.length}`, bypassCache ? 0 : TTL_MS, async () => {
        const payload = await fetchJson(buildOpenMeteoUrl(batch), { signal });
        if (payload?.error) throw new Error(payload.reason || 'Open-Meteo error');
        const list = Array.isArray(payload) ? payload : [payload];
        return list.map(normalizeOpenMeteoLocation);
      }),
    ),
  );
  return {
    results: outcomes.flatMap((outcome) => outcome.value),
    fetchedAt: Math.min(...outcomes.map((outcome) => outcome.fetchedAt)),
    stale: outcomes.some((outcome) => outcome.stale),
  };
}

const WMO = {
  0: 'Clear sky',
  1: 'Mainly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Rime fog',
  51: 'Light drizzle',
  53: 'Drizzle',
  55: 'Dense drizzle',
  61: 'Light rain',
  63: 'Rain',
  65: 'Heavy rain',
  80: 'Rain showers',
  81: 'Heavy showers',
  82: 'Violent showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm, hail',
  99: 'Thunderstorm, heavy hail',
};

export function describeWeatherCode(code) {
  return WMO[code] || (code == null ? '—' : `WMO ${code}`);
}

# AgriEye — Spatial Intelligence for Indian Agriculture

> See the farm. Understand the risk. Act earlier.

AgriEye is a software-only spatial intelligence globe for Indian agriculture.
It turns free, open weather, satellite and geographic data into transparent,
explainable agricultural indicators, drawn on a 3D globe and queryable in
plain language.

```
RAW DATA → SPATIAL ANALYSIS → AGRICULTURAL RISK → VISUALIZATION → ACTIONABLE INSIGHT
```

## Run it

```bash
npm install
npm run dev
```

- AgriEye: <http://localhost:4173/>
- Original God's Eye View console: <http://localhost:4173/gev.html>

No API keys are needed. Useful URL parameters:

| Parameter | Effect |
| --- | --- |
| `?state=tamil-nadu` | Open a state after the intro flight |
| `?region=tamil-nadu--tirunelveli` | Open a district analysis |
| `?demo=1` | Start in demo mode (archived snapshot) |
| `?q=Show agricultural water stress in Tamil Nadu` | Run a question on load |

Keyboard: `1`–`7` layers · `/` command bar · `H` India view · `D` data status ·
`E` 3D extrusion · `N` north up · `+`/`-` zoom · `Esc` close/deselect.

## Stage demo script

1. Load the page — the camera flies from space to India; state outlines appear.
2. Ask **“Show agricultural water stress in Tamil Nadu.”** Tamil Nadu loads,
   the Risk layer switches to *water stress*, HIGH districts are highlighted
   and listed with scores.
3. Type **“Tirunelveli”** (or click it) — the camera flies in and the right
   panel shows vegetation, soil moisture, temperature, rain probability,
   risk breakdown, solar opportunity and data freshness.
4. Ask **“Why is this region at risk?”** — the agent explains the factors and
   their point contributions from the loaded data.
5. Ask **“Show me areas where high irrigation demand overlaps with high solar
   potential.”** — the Solar layer highlights the HIGH solar-irrigation
   opportunity districts.

If the venue network is unreliable, tick **Demo dataset** in the data status
panel (or use `?demo=1`). Every surface then says **DEMO DATA**.

## Data sources

| Data | Source | Freshness label | Notes |
| --- | --- | --- | --- |
| Weather: temperature, humidity, wind, rain, rain probability, 30 past days, 7-day forecast, ET₀, shortwave radiation | [Open-Meteo](https://open-meteo.com/) forecast API (keyless, CC BY 4.0) | FORECAST | One multi-location request per state, sampled at district centroids |
| Soil moisture 3–27 cm | Open-Meteo land-surface model (ECMWF IFS / NOAA GFS) | NEAR-REAL-TIME (model estimate) | Converted to a relative index with generic loam bounds — a regional indicator, not a field reading |
| Vegetation (NDVI) | NASA MODIS Terra 8-day NDVI via [NASA GIBS](https://earthdata.nasa.gov/gibs) (keyless) | PERIODIC | Small WMS images per district decoded back to NDVI through the published GIBS colormap; compared with the composite 16 days earlier |
| Boundaries | [datameet/maps](https://github.com/datameet/maps) — Survey of India states, Census 2011 districts (CC BY 2.5 India) | STATIC | Simplified once by `scripts/agrieye/prepare-boundaries.mjs` |
| Basemaps | Esri World Imagery · Copernicus Sentinel-2 cloudless 2023 by EOX (CC BY-NC-SA 4.0) · OpenStreetMap (ODbL) | STATIC | Attribution is shown in the on-globe credits |
| Place search | Photon (komoot) over OpenStreetMap | — | Fallback for villages/towns; resolves to the containing district |

### Adapters that are deliberately not connected

- **ISRO VEDAS / Bhuvan soil moisture** — requires registration and has no
  keyless browser API. `createIsroSoilAdapter` defines the interface and
  reports *not connected*.
- **Copernicus Sentinel-2 NDVI statistics** — Sentinel Hub needs OAuth client
  credentials that must stay server-side. `createCopernicusNdviAdapter`
  defines the interface; the keyless Sentinel-2 cloudless mosaic is offered as
  a basemap instead.

Nothing is scraped, and failed live data is never silently replaced by demo
data: each source shows its own status (available / loading / empty /
temporarily unavailable / cached / demo) and the rest of the map keeps working.

## Indicators (deterministic and explainable)

Each input becomes a 0–1 stress, is weighted, and summed to a 0–100 score.
Missing inputs are excluded and listed; below 60% input coverage the result is
*insufficient data*. LOW < 35 ≤ MODERATE < 60 ≤ HIGH unless noted.

| Indicator | Inputs (weights) |
| --- | --- |
| Agricultural risk | soil dryness 30% · vegetation condition 25% · temperature 25% · rainfall forecast 20% |
| Water stress | soil dryness 35% · temperature 20% · low rain probability 20% · ET₀ vs forecast rain 15% · NDVI decline 10% |
| Possible crop stress | low NDVI 30% · NDVI decline 30% · heat 20% · soil dryness 20% (requires satellite data; always worded “possible”) |
| Climate risk (LOW/MEDIUM/HIGH) | dry spell 25% · past 30-day rain 20% · heat 20% · forecast rainfall extremes 20% · vegetation 15% |
| Heat risk | max forecast temperature within 3 days: < 35 °C LOW, 35–38 °C MEDIUM, ≥ 38 °C HIGH |
| Solar-irrigation opportunity | HIGH when irrigation demand is HIGH and mean forecast radiation ≥ 5 kWh/m²/day. Suitability only — does not confirm pumps |

## Architecture

AgriEye reuses the God's Eye View foundation — application lifecycle
(`src/app/application.js`), Cesium viewer factory (`src/app/viewer.js`),
map-source controller with provider fallback (`src/maps/controller.js`), idle
render governor (`src/renderGovernor.js`), credit registry
(`src/data/dataCredits.js`), logo gaze and the keyless Photon geocoder — and
adds everything agricultural under `src/agriculture/`:

```
src/agriculture/
  data/        adapters: weather/openMeteo, soil, vegetation/gibsNdvi,
               geography/boundaries, catalog (dataset descriptors), store
  model/       provenance (freshness/status), regionRecord (common model)
  analysis/    factors, waterStress, cropStress, climateRisk, heatRisk,
               solarOpportunity, agriculturalRisk
  layers/      layerDefinitions, regionRenderer (Cesium), basemaps
  ai/          places, agricultureAgent (intent → loaded data → actions), speech
  ui/          intelPanel, statusPanel, format, icons
  styles/      agrieye.css
  app.js       composition
```

**AI agent.** A deterministic intent parser, not a generative model: it reads
only the region records currently loaded, returns an answer plus map actions
(layer, highlight, fly, select), cites the sources and timestamps used, and
answers “I don't have sufficient data for this region” when inputs are
missing. Voice uses the browser's Web Speech API (keyless; Chrome/Edge). God's
Eye View's OpenAI Realtime voice remains in the original console but is not
used by AgriEye because it needs a paid key.

**Performance.** Only the state index and outlines (~150 kB) load at
startup; a state's districts and data load when it is opened. Responses are
cached per session. The globe is flat (no terrain), the render governor idles
when nothing moves, and entity colours update through per-instance attributes
so hover never rebuilds geometry.

## Maintenance scripts

```bash
# Rebuild simplified boundaries from the datameet shapefiles
node scripts/agrieye/prepare-boundaries.mjs <download-dir>

# Refresh the archived demo snapshot for a state
node scripts/agrieye/capture-demo-snapshot.mjs tamil-nadu
```

## Limitations

- Values are regional: weather and soil are sampled at district centroids;
  NDVI is a district mean that mixes cropland, forest and settlements.
- District boundaries are Census 2011; newer districts are resolved to their
  2011 parent (e.g. Tenkasi → Tirunelveli) and the agent says so.
- Crop types are not mapped; rainfall is compared with fixed thresholds, not a
  long-term climatology.

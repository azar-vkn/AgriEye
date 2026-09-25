import * as Cesium from 'cesium';
import { LAYER_BY_ID, NO_DATA } from './layerDefinitions.js';

// Draws state outlines and district polygons with Cesium entities. Entities
// are created once per boundary set; theme changes only restyle them, and
// geometry is rebuilt only when an extrusion height actually changes.

// Subtle relief: enough to read as 3D at state scale without walling off
// a district when the camera is close.
const BASE_HEIGHT = 800;
const EXTRUSION_RANGE = 14_000;
const FLAT_HEIGHT = 0;
const ACCENT = '#7fd38b';

const colorCache = new Map();
function color(css, alpha = 1) {
  const key = `${css}|${alpha.toFixed(3)}`;
  if (!colorCache.has(key)) colorCache.set(key, Cesium.Color.fromCssColorString(css).withAlpha(alpha));
  return colorCache.get(key);
}

function polygonsOf(geometry) {
  return geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
}

function hierarchy(rings) {
  const toPositions = (ring) => Cesium.Cartesian3.fromDegreesArray(ring.slice(0, -1).flat());
  return new Cesium.PolygonHierarchy(
    toPositions(rings[0]),
    rings.slice(1).map((ring) => new Cesium.PolygonHierarchy(toPositions(ring))),
  );
}

/** Colour read each frame, so restyling never rebuilds batched geometry. */
const dynamicColor = (owner, key) =>
  new Cesium.ColorMaterialProperty(new Cesium.CallbackProperty(() => owner[key], false));

const ringPositions = (ring, height) =>
  Cesium.Cartesian3.fromDegreesArrayHeights(ring.flatMap(([lon, lat]) => [lon, lat, height]));

export function createRegionRenderer(viewer, { requestRender = () => viewer.scene.requestRender() } = {}) {
  const stateSource = new Cesium.CustomDataSource('agrieye-states');
  const districtSource = new Cesium.CustomDataSource('agrieye-districts');
  viewer.dataSources.add(stateSource);
  viewer.dataSources.add(districtSource);

  const owners = new WeakMap();
  const states = new Map();
  const districts = new Map();
  const theme = {
    layerId: 'agriculture',
    variant: 'agriculturalRisk',
    extrude: true,
    showDistricts: true,
    hovered: null,
    selectedId: null,
    focusedStateId: null,
    highlight: null,
    records: new Map(),
    fillOpacity: 1,
  };
  const selectionOutline = districtSource.entities.add({
    show: false,
    polyline: {
      positions: [],
      width: 5,
      material: new Cesium.PolylineGlowMaterialProperty({ glowPower: 0.25, color: color('#e9ffe9', 0.95) }),
      arcType: Cesium.ArcType.NONE,
    },
  });

  function setStates(collection) {
    for (const feature of collection.features) {
      const id = feature.properties.id;
      if (states.has(id)) continue;
      const entry = { id, feature, fills: [], outlines: [], fillColor: color(ACCENT, 0.05), outlineColor: color('#ffffff', 0.28) };
      for (const rings of polygonsOf(feature.geometry)) {
        const fill = stateSource.entities.add({
          polygon: {
            hierarchy: hierarchy(rings),
            height: FLAT_HEIGHT,
            material: dynamicColor(entry, 'fillColor'),
          },
        });
        owners.set(fill, { kind: 'state', id });
        entry.fills.push(fill);
        const outline = stateSource.entities.add({
          polyline: {
            positions: ringPositions(rings[0], 400),
            width: 1.4,
            material: dynamicColor(entry, 'outlineColor'),
            arcType: Cesium.ArcType.NONE,
          },
        });
        owners.set(outline, { kind: 'state', id });
        entry.outlines.push(outline);
      }
      states.set(id, entry);
    }
    render();
  }

  function setDistricts(stateId, features) {
    for (const feature of features) {
      const id = feature.properties.id;
      if (districts.has(id)) continue;
      const parts = polygonsOf(feature.geometry);
      const entry = {
        id,
        stateId,
        feature,
        parts,
        fills: [],
        outlines: [],
        height: null,
        label: null,
        fillColor: color(ACCENT, 0.3),
        outlineColor: color('#ffffff', 0.4),
      };
      for (const rings of parts) {
        const fill = districtSource.entities.add({
          polygon: {
            hierarchy: hierarchy(rings),
            height: FLAT_HEIGHT,
            extrudedHeight: BASE_HEIGHT,
            material: dynamicColor(entry, 'fillColor'),
          },
        });
        owners.set(fill, { kind: 'district', id });
        entry.fills.push(fill);
        const outline = districtSource.entities.add({
          polyline: {
            positions: ringPositions(rings[0], BASE_HEIGHT + 60),
            width: 1.5,
            material: dynamicColor(entry, 'outlineColor'),
            arcType: Cesium.ArcType.NONE,
          },
        });
        owners.set(outline, { kind: 'district', id });
        entry.outlines.push(outline);
      }
      const [lon, lat] = feature.properties.centroid;
      entry.label = districtSource.entities.add({
        position: Cesium.Cartesian3.fromDegrees(lon, lat, BASE_HEIGHT + 800),
        label: {
          text: feature.properties.name,
          font: '500 12px Inter, sans-serif',
          fillColor: color('#f2f6f2', 0.92),
          outlineColor: color('#050806', 0.9),
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: Cesium.VerticalOrigin.CENTER,
          horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 1_700_000),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          scaleByDistance: new Cesium.NearFarScalar(2e5, 1.05, 1.7e6, 0.8),
          show: false,
        },
      });
      owners.set(entry.label, { kind: 'district', id });
      districts.set(id, entry);
    }
    render();
  }

  function heightFor(entry, layer, record) {
    if (!theme.extrude) return FLAT_HEIGHT + 300;
    let t = 0.08;
    if (record && layer) {
      const value = layer.extrusion(record, theme.variant);
      t = Number.isFinite(value) ? Math.max(0.03, value) : 0.03;
    }
    return Math.round(BASE_HEIGHT + t * EXTRUSION_RANGE);
  }

  function styleDistrict(entry, layer) {
    const record = theme.records.get(entry.id);
    const band = record && layer ? layer.classify(record, theme.variant) : NO_DATA;
    const isHovered = theme.hovered?.kind === 'district' && theme.hovered.id === entry.id;
    const isSelected = theme.selectedId === entry.id;
    const dimmed = theme.highlight && !theme.highlight.has(entry.id);
    const emphasized = theme.highlight?.has(entry.id);
    const hasData = band !== NO_DATA;
    let alpha = layer.id === 'agriculture' ? 0.28 : hasData ? 0.62 : 0.18;
    if (dimmed) alpha = 0.08;
    if (emphasized) alpha = Math.max(alpha, 0.78);
    if (isHovered) alpha = Math.min(0.92, alpha + 0.22);
    if (isSelected) alpha = Math.max(alpha, 0.82);
    alpha *= theme.fillOpacity;
    const fill = color(band.color, alpha);
    const outline = isSelected || isHovered
      ? color('#ffffff', 0.95)
      : emphasized
        ? color(band.color === NO_DATA.color ? '#ffffff' : band.color, 0.95)
        : color('#ffffff', dimmed ? 0.12 : 0.38);

    const height = heightFor(entry, layer, record);
    const heightChanged = height !== entry.height;
    entry.height = height;
    const visible = theme.showDistricts;
    entry.fillColor = fill;
    entry.outlineColor = outline;
    entry.parts.forEach((rings, i) => {
      const polygon = entry.fills[i].polygon;
      entry.fills[i].show = visible;
      if (heightChanged) {
        polygon.extrudedHeight = theme.extrude ? height : undefined;
        polygon.height = theme.extrude ? FLAT_HEIGHT : height - 300;
        entry.outlines[i].polyline.positions = ringPositions(rings[0], height + 60);
      }
      entry.outlines[i].show = visible;
    });
    const [lon, lat] = entry.feature.properties.centroid;
    if (heightChanged) entry.label.position = Cesium.Cartesian3.fromDegrees(lon, lat, height + 900);
    const showLabel =
      visible &&
      (entry.stateId === theme.focusedStateId || isSelected || emphasized) &&
      !(dimmed && !isHovered);
    entry.label.label.show = showLabel;
    entry.label.label.text =
      layer.mapLabel && record ? layer.mapLabel(record) : entry.feature.properties.name;
    if (isSelected) {
      selectionOutline.polyline.positions = entry.parts.flatMap((rings, i) =>
        i === 0 ? ringPositions(rings[0], height + 120) : [],
      );
      selectionOutline.show = visible;
    }
  }

  function render() {
    const layer = LAYER_BY_ID[theme.layerId] || LAYER_BY_ID.agriculture;
    for (const entry of states.values()) {
      const isHovered = theme.hovered?.kind === 'state' && theme.hovered.id === entry.id;
      const focused = theme.focusedStateId === entry.id;
      const loaded = [...districts.values()].some((d) => d.stateId === entry.id);
      const fillAlpha = focused || (loaded && theme.showDistricts) ? 0.001 : isHovered ? 0.16 : 0.045;
      entry.fillColor = color(ACCENT, fillAlpha);
      entry.outlineColor = color(
        isHovered || focused ? '#bdf0c4' : '#ffffff',
        focused ? 0.75 : isHovered ? 0.8 : 0.28,
      );
    }
    if (!theme.selectedId || !districts.has(theme.selectedId)) selectionOutline.show = false;
    for (const entry of districts.values()) styleDistrict(entry, layer);
    requestRender('agrieye-regions');
  }

  return Object.freeze({
    setStates,
    setDistricts,
    /** Merge theme changes and restyle. */
    update(patch) {
      Object.assign(theme, patch);
      render();
    },
    getTheme: () => ({ ...theme }),
    /** Identify the region under a window position, if any. */
    pick(windowPosition) {
      const picked = viewer.scene.pick(windowPosition);
      const entity = picked?.id instanceof Cesium.Entity ? picked.id : null;
      return entity ? owners.get(entity) || null : null;
    },
    destroy() {
      viewer.dataSources.remove(stateSource, true);
      viewer.dataSources.remove(districtSource, true);
    },
  });
}

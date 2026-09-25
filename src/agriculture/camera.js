import * as Cesium from 'cesium';
import { INDIA_BBOX } from './geo.js';

export { INDIA_BBOX, unionBBox } from './geo.js';

// Cinematic, oblique camera moves between India, a state and a district.

const ease = Cesium.EasingFunction.CUBIC_IN_OUT;

function sphereFor([west, south, east, north]) {
  const corners = [
    [west, south],
    [east, south],
    [east, north],
    [west, north],
    [(west + east) / 2, (south + north) / 2],
  ].map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat, 0));
  return Cesium.BoundingSphere.fromPoints(corners);
}

export function createCameraController(viewer, { onFlightStart, onFlightEnd } = {}) {
  const camera = viewer.camera;
  let flying = false;

  function fly(bbox, { pitchDeg = -58, headingDeg = 0, duration = 2.8, rangeScale = 1 } = {}) {
    return new Promise((resolve) => {
      const sphere = sphereFor(bbox);
      const pitch = Cesium.Math.toRadians(pitchDeg);
      const fov = camera.frustum.fovy || Cesium.Math.toRadians(60);
      const range = (sphere.radius / Math.sin(fov / 2)) * 0.92 * rangeScale;
      camera.cancelFlight();
      flying = true;
      onFlightStart?.();
      camera.flyToBoundingSphere(sphere, {
        offset: new Cesium.HeadingPitchRange(Cesium.Math.toRadians(headingDeg), pitch, range),
        duration,
        easingFunction: ease,
        complete: () => {
          flying = false;
          onFlightEnd?.();
          resolve(true);
        },
        cancel: () => {
          flying = false;
          onFlightEnd?.();
          resolve(false);
        },
      });
    });
  }

  return Object.freeze({
    isFlying: () => flying,
    /** Park the camera far above the Indian Ocean before the intro flight. */
    setSpaceView() {
      camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(62, 2, 24_000_000),
        orientation: { heading: 0, pitch: -Cesium.Math.PI_OVER_TWO, roll: 0 },
      });
    },
    flyToIndia(options = {}) {
      return fly(INDIA_BBOX, { pitchDeg: -72, duration: 4.2, rangeScale: 0.95, ...options });
    },
    flyToState(entry, options = {}) {
      return fly(entry.bbox, { pitchDeg: -55, duration: 2.8, ...options });
    },
    flyToRegion(record, options = {}) {
      return fly(record.bbox, { pitchDeg: -62, duration: 2.4, rangeScale: 1.45, ...options });
    },
    flyToBBox: fly,
    flyToGlobe() {
      camera.cancelFlight();
      camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(78, 18, 20_000_000),
        duration: 2.5,
        easingFunction: ease,
      });
    },
    zoom(factor) {
      const height = camera.positionCartographic.height;
      if (factor > 1) camera.zoomOut(height * (factor - 1));
      else camera.zoomIn(height * (1 - factor));
    },
    resetNorth() {
      const carto = camera.positionCartographic;
      camera.flyTo({
        destination: Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, carto.height),
        orientation: { heading: 0, pitch: camera.pitch, roll: 0 },
        duration: 0.8,
      });
    },
  });
}

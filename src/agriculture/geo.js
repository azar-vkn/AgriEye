// Plain geographic helpers shared by the camera, agent and search.
export const INDIA_BBOX = Object.freeze([68.1, 6.5, 97.4, 35.7]);

/** Union of several [west, south, east, north] boxes. */
export function unionBBox(boxes) {
  return boxes.reduce(
    ([w, s, e, n], [w2, s2, e2, n2]) => [Math.min(w, w2), Math.min(s, s2), Math.max(e, e2), Math.max(n, n2)],
    [180, 90, -180, -90],
  );
}

/**
 * Geographic projection helpers for the 2D world map view.
 *
 * Phase 7C-lite (companion to the 3D ecosystem graph in compute-graph.tsx).
 * Pure functions only — no SVG/DOM dependency — so they can be unit-tested
 * and reused by a future Three.js globe upgrade.
 *
 *   latLngToSvg     equirectangular projection → SVG x/y
 *   arcPathBetween  curved-bezier SVG `d` string for flow arcs
 *   cityToVec       3D unit-vector for later globe upgrade
 */

export interface XY {
  x: number
  y: number
}

/**
 * Equirectangular projection: lng directly maps to x, lat to y.
 * Cheap, no distortion at equator, OK distortion at poles. Good enough for
 * a Bloomberg-style "every dot is a city" world map at 1200×600.
 *
 * @param lat   degrees, +90 = north pole, -90 = south pole
 * @param lng   degrees, -180 = international date line west, +180 east
 * @param width svg viewport width in px
 * @param height svg viewport height in px
 */
export function latLngToSvg(lat: number, lng: number, width: number, height: number): XY {
  // Clamp out-of-range inputs so a bad coord can't break the SVG layout.
  const clampedLat = Math.max(-90, Math.min(90, lat))
  const clampedLng = Math.max(-180, Math.min(180, lng))
  const x = ((clampedLng + 180) / 360) * width
  // SVG y axis grows downward, so invert latitude.
  const y = ((90 - clampedLat) / 180) * height
  return { x, y }
}

/**
 * Quadratic-bezier arc between two projected city positions. The control
 * point is lifted toward y=0 (north) by a fraction of the segment length,
 * giving each arc a Great-Circle-ish curve when seen on a flat map.
 *
 * Returns an SVG path `d` string suitable for use with <path d="…">.
 *
 * @param from  projected source point
 * @param to    projected destination point
 * @param height svg viewport height (used to scale the arc lift)
 * @returns SVG path string
 */
export function arcPathBetween(from: XY, to: XY, height: number): string {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const dist = Math.hypot(dx, dy)

  // Mid-point along the chord.
  const mx = (from.x + to.x) / 2
  const my = (from.y + to.y) / 2

  // Lift the control point perpendicular to the chord, biased northward
  // (i.e. in the -y direction) so arcs always bow up like flight paths.
  // Lift magnitude scales with segment length, capped at 25% of viewport
  // height so long arcs don't shoot off the canvas.
  const lift = Math.min(dist * 0.35, height * 0.25)

  // Perpendicular unit vector (rotated +90deg from the chord); we want it to
  // point "up" on screen (smaller y), so pick the sign of nx that gives -y.
  const nx = dy === 0 && dx === 0 ? 0 : -dy / Math.max(dist, 1)
  const ny = dy === 0 && dx === 0 ? -1 :  dx / Math.max(dist, 1)
  // If the perpendicular ends up pointing south (+y), flip it.
  const flip = ny > 0 ? -1 : 1

  const cx = mx + nx * lift * flip
  const cy = my + ny * lift * flip

  return `M ${from.x.toFixed(2)} ${from.y.toFixed(2)} Q ${cx.toFixed(2)} ${cy.toFixed(2)} ${to.x.toFixed(2)} ${to.y.toFixed(2)}`
}

/**
 * Spherical (lat, lng) → 3D unit vector on the unit sphere.
 * Reserved for a future Three.js globe upgrade (Phase 7C-full).
 * Uses the standard geographic convention: +y is north, +x is at (lat=0, lng=0).
 */
export function cityToVec(lat: number, lng: number): { x: number; y: number; z: number } {
  const phi = (lat * Math.PI) / 180
  const theta = (lng * Math.PI) / 180
  const cosPhi = Math.cos(phi)
  return {
    x: cosPhi * Math.cos(theta),
    y: Math.sin(phi),
    z: cosPhi * Math.sin(theta),
  }
}

/**
 * Cluster a list of projected XY points if any pair lies within `threshold`
 * pixels. Returns the cluster centroid + the list of original indices that
 * belong to it. O(n²) — fine for ~100 cos; revisit if we hit thousands.
 *
 * Used by the world map to merge HQ-co-located companies (e.g. NVDA/AMD/Intel
 * all in Santa Clara) into a single labeled badge.
 */
export interface Cluster<T> {
  cx: number
  cy: number
  items: T[]
}
export function clusterByProximity<T>(
  points: Array<{ xy: XY; item: T }>,
  thresholdPx: number,
): Array<Cluster<T>> {
  const used = new Array<boolean>(points.length).fill(false)
  const clusters: Array<Cluster<T>> = []
  for (let i = 0; i < points.length; i++) {
    if (used[i]) continue
    used[i] = true
    const group: T[] = [points[i].item]
    let sumX = points[i].xy.x
    let sumY = points[i].xy.y
    for (let j = i + 1; j < points.length; j++) {
      if (used[j]) continue
      const dx = points[j].xy.x - points[i].xy.x
      const dy = points[j].xy.y - points[i].xy.y
      if (Math.hypot(dx, dy) <= thresholdPx) {
        used[j] = true
        group.push(points[j].item)
        sumX += points[j].xy.x
        sumY += points[j].xy.y
      }
    }
    clusters.push({ cx: sumX / group.length, cy: sumY / group.length, items: group })
  }
  return clusters
}

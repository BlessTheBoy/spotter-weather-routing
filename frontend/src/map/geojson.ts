import type { Feature, FeatureCollection, LineString, Point, Polygon } from 'geojson'
import type { Corridor, LngLat, Plan, Route } from '../api/types'

const EARTH_RADIUS_MI = 3958.7613

function haversineMi([lng1, lat1]: LngLat, [lng2, lat2]: LngLat): number {
  const r = Math.PI / 180
  const h =
    Math.sin(((lat2 - lat1) * r) / 2) ** 2 +
    Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lng2 - lng1) * r) / 2) ** 2
  return 2 * EARTH_RADIUS_MI * Math.asin(Math.sqrt(h))
}

/** Corridor hexes with numeric ids, so colours can be driven by feature-state. */
export function corridorFeatures(corridor: Corridor): FeatureCollection<Polygon> {
  return {
    type: 'FeatureCollection',
    features: corridor.cells.map((cell, i) => ({
      type: 'Feature',
      id: i,
      properties: {},
      geometry: { type: 'Polygon', coordinates: [cell.boundary] },
    })),
  }
}

/**
 * Each route cut into the stretches its checkpoints stand for, coloured by
 * that checkpoint's risk at the truck's ETA.
 */
export function riskSegments(plan: Plan): FeatureCollection<LineString> {
  const features: Feature<LineString>[] = []
  for (const route of plan.routes) {
    const miles = cumulativeMiles(route)
    const cps = route.checkpoints
    cps.forEach((cp, i) => {
      const from = i === 0 ? 0 : (cps[i - 1].mile + cp.mile) / 2
      const to = i === cps.length - 1 ? route.distance_mi : (cp.mile + cps[i + 1].mile) / 2
      const coords = slice(route.geometry, miles, from, to)
      if (coords.length > 1) {
        features.push({
          type: 'Feature',
          properties: { route: route.id, level: cp.level ?? -1 },
          geometry: { type: 'LineString', coordinates: coords },
        })
      }
    })
  }
  return { type: 'FeatureCollection', features }
}

export function routeLines(plan: Plan): FeatureCollection<LineString> {
  return {
    type: 'FeatureCollection',
    features: plan.routes.map((r) => ({
      type: 'Feature',
      properties: { route: r.id },
      geometry: { type: 'LineString', coordinates: r.geometry },
    })),
  }
}

export function checkpointFeatures(plan: Plan): FeatureCollection<Point> {
  const features: Feature<Point>[] = []
  plan.routes.forEach((r, ri) =>
    r.checkpoints.forEach((cp, ci) =>
      features.push({
        type: 'Feature',
        // Stable numeric id so hover highlighting can use feature-state.
        id: ri * 10_000 + ci,
        properties: { route: r.id, index: ci, level: cp.level ?? -1 },
        geometry: { type: 'Point', coordinates: [cp.lng, cp.lat] },
      }),
    ),
  )
  return { type: 'FeatureCollection', features }
}

export function checkpointId(plan: Plan, routeId: string, index: number): number {
  return plan.routes.findIndex((r) => r.id === routeId) * 10_000 + index
}

export function endpoints(plan: Plan): FeatureCollection<Point> {
  const r = plan.routes[0]
  const mk = (coord: LngLat, kind: string): Feature<Point> => ({
    type: 'Feature',
    properties: { kind },
    geometry: { type: 'Point', coordinates: coord },
  })
  return { type: 'FeatureCollection', features: [mk(r.geometry[0], 'origin'), mk(r.geometry[r.geometry.length - 1], 'destination')] }
}

function cumulativeMiles(route: Route): number[] {
  const out = [0]
  for (let i = 1; i < route.geometry.length; i++) out.push(out[i - 1] + haversineMi(route.geometry[i - 1], route.geometry[i]))
  // Scale to the provider's distance so checkpoint miles line up.
  const k = route.distance_mi / (out[out.length - 1] || 1)
  return out.map((m) => m * k)
}

function lerp(a: LngLat, b: LngLat, t: number): LngLat {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
}

function pointAt(geometry: LngLat[], miles: number[], mile: number): LngLat {
  const i = miles.findIndex((m) => m >= mile)
  if (i === 0) return geometry[0]
  // Float drift can leave the destination a hair past the last vertex.
  if (i < 0) return geometry[geometry.length - 1]
  const span = miles[i] - miles[i - 1]
  return lerp(geometry[i - 1], geometry[i], span ? (mile - miles[i - 1]) / span : 0)
}

function slice(geometry: LngLat[], miles: number[], from: number, to: number): LngLat[] {
  const inner = geometry.filter((_, i) => miles[i] > from && miles[i] < to)
  return [pointAt(geometry, miles, from), ...inner, pointAt(geometry, miles, to)]
}

export function boundsOf(plan: Plan): [LngLat, LngLat] {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const r of plan.routes)
    for (const [x, y] of r.geometry) {
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
  return [
    [minX, minY],
    [maxX, maxY],
  ]
}

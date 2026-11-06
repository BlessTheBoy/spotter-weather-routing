import type { Feature, FeatureCollection, LineString, Point, Polygon } from 'geojson'
import type { Corridor, LngLat, Plan, Route } from '../api/types'
import { badgeOf, type CheckpointState } from '../lib/plan'

const EARTH_RADIUS_MI = 3958.7613

function haversineMi([lng1, lat1]: LngLat, [lng2, lat2]: LngLat): number {
  const r = Math.PI / 180
  const h = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lng2 - lng1) * r) / 2) ** 2
  return 2 * EARTH_RADIUS_MI * Math.asin(Math.sqrt(h))
}

export function cumulativeMiles(route: Route): number[] {
  const out = [0]
  for (let i = 1; i < route.geometry.length; i++) out.push(out[i - 1] + haversineMi(route.geometry[i - 1], route.geometry[i]))
  // Scale to the provider's distance so checkpoint miles line up.
  const k = route.distance_mi / (out[out.length - 1] || 1)
  return out.map((m) => m * k)
}

/** Corridor hexes with numeric ids, so colours can be driven by feature-state. */
export function corridorFeatures(corridor: Corridor): FeatureCollection<Polygon> {
  return {
    type: 'FeatureCollection',
    features: corridor.cells.map((cell, i) => ({ type: 'Feature', id: i, properties: {}, geometry: { type: 'Polygon', coordinates: [cell.boundary] } })),
  }
}

export function routeLines(plan: Plan): FeatureCollection<LineString> {
  return {
    type: 'FeatureCollection',
    features: plan.routes.map((r) => ({ type: 'Feature', properties: { route: r.id }, geometry: { type: 'LineString', coordinates: r.geometry } })),
  }
}

/** The selected route cut into the stretches its checkpoints stand for, coloured by risk at ETA. */
export function riskSegments(route: Route, states: CheckpointState[], fromMile = 0): FeatureCollection<LineString> {
  const miles = cumulativeMiles(route)
  const features: Feature<LineString>[] = []
  states.forEach((cp, i) => {
    const from = Math.max(fromMile, i === 0 ? 0 : (states[i - 1].mile + cp.mile) / 2)
    const to = i === states.length - 1 ? route.distance_mi : (cp.mile + states[i + 1].mile) / 2
    if (to <= from) return
    const coords = slice(route.geometry, miles, from, to)
    if (coords.length > 1) features.push({ type: 'Feature', properties: { level: cp.level ?? -1 }, geometry: { type: 'LineString', coordinates: coords } })
  })
  return { type: 'FeatureCollection', features }
}

export function checkpointFeatures(route: Route, states: CheckpointState[]): FeatureCollection<Point> {
  return {
    type: 'FeatureCollection',
    features: states.map((s) => ({ type: 'Feature', id: s.index, properties: { route: route.id, index: s.index, level: s.level ?? -1 }, geometry: { type: 'Point', coordinates: [s.lng, s.lat] } })),
  }
}

export function badgeFeatures(states: CheckpointState[]): FeatureCollection<Point> {
  const features: Feature<Point>[] = []
  for (const s of states) {
    const b = badgeOf(s)
    if (b) features.push({ type: 'Feature', properties: { image: `badge:${b.level}:${b.elements}`, rank: 4 - b.level, index: s.index }, geometry: { type: 'Point', coordinates: [s.lng, s.lat] } })
  }
  return { type: 'FeatureCollection', features }
}

export function endpoints(plan: Plan): FeatureCollection<Point> {
  const pt = (p: { lng: number; lat: number }, kind: string): Feature<Point> => ({ type: 'Feature', properties: { kind }, geometry: { type: 'Point', coordinates: [p.lng, p.lat] } })
  const r = plan.routes[0]
  const [o, d] = [r.geometry[0], r.geometry[r.geometry.length - 1]]
  return {
    type: 'FeatureCollection',
    features: [pt({ lng: o[0], lat: o[1] }, 'origin'), ...plan.stops.map((s) => pt(s, 'stop')), pt({ lng: d[0], lat: d[1] }, 'destination')],
  }
}

function lerp(a: LngLat, b: LngLat, t: number): LngLat {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
}

export function pointAtMile(geometry: LngLat[], miles: number[], mile: number): LngLat {
  const i = miles.findIndex((m) => m >= mile)
  if (i === 0) return geometry[0]
  // Float drift can leave the destination a hair past the last vertex.
  if (i < 0) return geometry[geometry.length - 1]
  const span = miles[i] - miles[i - 1]
  return lerp(geometry[i - 1], geometry[i], span ? (mile - miles[i - 1]) / span : 0)
}

function slice(geometry: LngLat[], miles: number[], from: number, to: number): LngLat[] {
  const inner = geometry.filter((_, i) => miles[i] > from && miles[i] < to)
  return [pointAtMile(geometry, miles, from), ...inner, pointAtMile(geometry, miles, to)]
}

export function boundsOf(routes: Route[]): [LngLat, LngLat] {
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity]
  for (const r of routes)
    for (const [x, y] of r.geometry) ((minX = Math.min(minX, x)), (minY = Math.min(minY, y)), (maxX = Math.max(maxX, x)), (maxY = Math.max(maxY, y)))
  return [
    [minX, minY],
    [maxX, maxY],
  ]
}

// Mock-only mirror of backend/planner/domain/geometry.py.
import type { Instruction, LngLat } from '../api/types'

const R_MI = 3958.7613
const rad = Math.PI / 180

export function haversineMi([x1, y1]: LngLat, [x2, y2]: LngLat): number {
  const h = Math.sin(((y2 - y1) * rad) / 2) ** 2 + Math.cos(y1 * rad) * Math.cos(y2 * rad) * Math.sin(((x2 - x1) * rad) / 2) ** 2
  return 2 * R_MI * Math.asin(Math.sqrt(h))
}

export function cumulativeMiles(points: LngLat[], totalMi?: number): number[] {
  const out = [0]
  for (let i = 1; i < points.length; i++) out.push(out[i - 1] + haversineMi(points[i - 1], points[i]))
  const k = totalMi ? totalMi / (out[out.length - 1] || 1) : 1
  return out.map((m) => m * k)
}

function interp(x: number, xs: number[], ys: number[]): number {
  let lo = 0
  let hi = xs.length - 1
  if (x <= xs[0]) return ys[0]
  if (x >= xs[hi]) return ys[hi]
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (xs[mid] <= x) lo = mid
    else hi = mid
  }
  const t = xs[hi] === xs[lo] ? 0 : (x - xs[lo]) / (xs[hi] - xs[lo])
  return ys[lo] + t * (ys[hi] - ys[lo])
}

export interface RawCheckpoint {
  mile: number
  lng: number
  lat: number
  eta_offset_s: number
  represents_mi: number
}

export function checkpointsAlong(points: LngLat[], times: number[], intervalMi: number, totalMi: number): RawCheckpoint[] {
  const miles = cumulativeMiles(points, totalMi)
  const length = miles[miles.length - 1]
  const marks: number[] = []
  for (let m = 0; m <= length; m += intervalMi) marks.push(m)
  if (length - marks[marks.length - 1] > 1e-6) marks.push(length)
  const lngs = points.map((p) => p[0])
  const lats = points.map((p) => p[1])
  return marks.map((mile, i) => ({
    mile,
    lng: interp(mile, miles, lngs),
    lat: interp(mile, miles, lats),
    eta_offset_s: interp(mile, miles, times),
    represents_mi: ((i > 0 ? mile - marks[i - 1] : 0) + (i + 1 < marks.length ? marks[i + 1] - mile : 0)) / 2,
  }))
}

function bearing([x1, y1]: LngLat, [x2, y2]: LngLat): number {
  const y = Math.sin((x2 - x1) * rad) * Math.cos(y2 * rad)
  const x = Math.cos(y1 * rad) * Math.sin(y2 * rad) - Math.sin(y1 * rad) * Math.cos(y2 * rad) * Math.cos((x2 - x1) * rad)
  return (Math.atan2(y, x) / rad + 360) % 360
}

/**
 * Synthetic turn-by-turn steps from heading changes along the line. Real
 * guidance will come from TomTom; this is only enough to exercise Navigate.
 */
export function syntheticInstructions(points: LngLat[], totalMi: number): Instruction[] {
  const miles = cumulativeMiles(points, totalMi)
  const out: Instruction[] = [{ mile: 0, maneuver: 'depart', text: 'Head out on the route', road: null }]
  let lastMile = 0
  let lastBearing = bearing(points[0], points[Math.min(points.length - 1, 5)])
  const step = Math.max(1, Math.floor(points.length / 400))
  for (let i = step; i < points.length - step; i += step) {
    if (miles[i] - lastMile < 15) continue
    const b = bearing(points[i], points[i + step])
    const turn = ((b - lastBearing + 540) % 360) - 180
    if (Math.abs(turn) > 35) {
      const sharp = Math.abs(turn) > 70
      const left = turn < 0
      out.push({
        mile: Math.round(miles[i] * 10) / 10,
        maneuver: sharp ? (left ? 'left' : 'right') : left ? 'slight_left' : 'slight_right',
        text: `${sharp ? 'Turn' : 'Keep'} ${left ? 'left' : 'right'}`,
        road: null,
      })
      lastMile = miles[i]
    }
    lastBearing = b
  }
  out.push({ mile: Math.round(totalMi * 10) / 10, maneuver: 'arrive', text: 'Arrive at your destination', road: null })
  return out
}

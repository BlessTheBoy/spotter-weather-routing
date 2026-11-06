import type { Corridor, LngLat, Route } from '@/api/types'

export type Layer = 'risk' | 'wind_mph' | 'rain_in_hr' | 'snow_in_hr'

export const LAYERS: Record<Layer, { label: string; unit: string; stops: [number, string][] }> = {
  risk: { label: 'Risk', unit: '', stops: [] },
  wind_mph: {
    label: 'Wind',
    unit: 'mph',
    stops: [
      [0, '#1d3b4f'],
      [15, '#2a788e'],
      [25, '#22a884'],
      [35, '#7ad151'],
      [45, '#fde725'],
      [55, '#ff4d6d'],
    ],
  },
  rain_in_hr: {
    label: 'Rain',
    unit: 'in/hr',
    stops: [
      [0, 'rgba(0,0,0,0)'],
      [0.02, '#1f4e79'],
      [0.1, '#2f80ed'],
      [0.25, '#56ccf2'],
      [0.5, '#bb6bd9'],
      [1, '#ff4d6d'],
    ],
  },
  snow_in_hr: {
    label: 'Snow',
    unit: 'in/hr',
    stops: [
      [0, 'rgba(0,0,0,0)'],
      [0.05, '#4a5a8a'],
      [0.5, '#8fa8ff'],
      [1, '#c9d6ff'],
      [2, '#ffffff'],
      [3, '#ff4d6d'],
    ],
  },
}

/**
 * Per-cell values for a fractional forecast hour. Continuous layers blend
 * linearly between the two neighbouring hours so scrubbing and playback look
 * continuous; risk is a category, so it snaps to the nearest hour.
 */
export function valuesAt(corridor: Corridor, layer: Layer, hour: number, out: Float32Array): Float32Array {
  const n = corridor.cells.length
  const last = corridor.hours.length - 1
  const data = corridor[layer]
  if (layer === 'risk') {
    const base = Math.min(last, Math.max(0, Math.round(hour))) * n
    for (let i = 0; i < n; i++) out[i] = data[base + i]
    return out
  }
  const h0 = Math.min(last, Math.max(0, Math.floor(hour)))
  const h1 = Math.min(last, h0 + 1)
  const t = Math.min(1, Math.max(0, hour - h0))
  for (let i = 0; i < n; i++) out[i] = data[h0 * n + i] * (1 - t) + data[h1 * n + i] * t
  return out
}

/** Where the truck is on a route at an absolute time, or null before departure / after arrival. */
export function positionAt(route: Route, departureMs: number, timeMs: number): LngLat | null {
  const elapsed = (timeMs - departureMs) / 1000
  const times = route.geometry_times_s
  if (elapsed < 0 || elapsed > times[times.length - 1]) return null
  return positionAfter(route, elapsed)
}

/** Position after a number of seconds of driving, clamped to the route. */
export function positionAfter(route: Route, elapsedS: number): LngLat {
  const times = route.geometry_times_s
  const elapsed = Math.min(Math.max(0, elapsedS), times[times.length - 1])
  let lo = 0
  let hi = times.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (times[mid] <= elapsed) lo = mid
    else hi = mid
  }
  const span = times[hi] - times[lo]
  const t = span > 0 ? (elapsed - times[lo]) / span : 0
  const [x0, y0] = route.geometry[lo]
  const [x1, y1] = route.geometry[hi]
  return [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t]
}

export function hourToTime(corridor: Corridor, hour: number): number {
  return Date.parse(corridor.hours[0]) + hour * 3600_000
}

/**
 * Trip view: each hex shows the forecast for the hour the selected truck is
 * nearest to it, so the heatmap and the route colours share one clock.
 * `cellTimes` holds, per cell, the driving seconds to the closest route point.
 */
export function valuesAtEta(corridor: Corridor, layer: Layer, departureMs: number, cellTimes: Float64Array, out: Float32Array): Float32Array {
  const n = corridor.cells.length
  const last = corridor.hours.length - 1
  const start = Date.parse(corridor.hours[0])
  const data = corridor[layer]
  for (let i = 0; i < n; i++) {
    const h = Math.min(last, Math.max(0, Math.round((departureMs + cellTimes[i] * 1000 - start) / 3600_000)))
    out[i] = data[h * n + i]
  }
  return out
}

/** Driving seconds from the route start to the route vertex nearest each cell. */
export function cellPassTimes(corridor: Corridor, route: Route): Float64Array {
  const out = new Float64Array(corridor.cells.length)
  const step = Math.max(1, Math.floor(route.geometry.length / 400))
  corridor.cells.forEach((c, i) => {
    let best = 0
    let bestD = Infinity
    for (let j = 0; j < route.geometry.length; j += step) {
      const [x, y] = route.geometry[j]
      const d = (x - c.center[0]) ** 2 + (y - c.center[1]) ** 2
      if (d < bestD) ((bestD = d), (best = j))
    }
    out[i] = route.geometry_times_s[best]
  })
  return out
}

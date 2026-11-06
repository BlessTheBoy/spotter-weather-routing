// Synthetic weather for the mock backend: a few moving storm cells laid over a
// calm background, so every risk level, element and the load rules can be seen.

export type ScenarioId = 'live' | 'calm' | 'rain_band' | 'wind_heavy_load' | 'mountain_snow' | 'blowout' | 'mixed'

export const SCENARIOS: { id: ScenarioId; label: string; hint: string }[] = [
  { id: 'mixed', label: 'Mixed (default)', hint: 'One clean route; Severe rain and snow on the fastest; a No Travel wind storm on another' },
  { id: 'live', label: 'Recorded forecast', hint: 'The real forecast captured when the fixture was made' },
  { id: 'calm', label: 'Calm', hint: 'Everything Low' },
  { id: 'rain_band', label: 'Rain band', hint: 'A heavy rain line sweeps east across the routes' },
  { id: 'wind_heavy_load', label: 'High wind', hint: '35–50 mph wind; try loads above 30k and 40k lb' },
  { id: 'mountain_snow', label: 'Mountain snow', hint: 'Snow over the high ground, worst overnight' },
  { id: 'blowout', label: 'No Travel', hint: 'A 60 mph wind storm sits on one route' },
]

export interface Weather {
  wind: number
  gust: number
  rain: number
  snow: number
}

interface Cell {
  /** Start position (lng, lat) and drift in degrees per hour. */
  lng: number
  lat: number
  dLng: number
  dLat: number
  /** Radius in degrees, peak hour (hours after departure) and duration in hours. */
  radius: number
  peakHour: number
  spanHours: number
  wind?: number
  rain?: number
  snow?: number
}

export interface ScenarioRoute {
  geometry: [number, number][]
  geometry_times_s: number[]
  duration_s: number
}

/** Distance (degrees, latitude-corrected) from a point to the nearest vertex of other routes. */
function gapTo(p: [number, number], others: ScenarioRoute[]): number {
  let best = Infinity
  const k = Math.cos((p[1] * Math.PI) / 180)
  for (const o of others) for (let j = 0; j < o.geometry.length; j += 4) best = Math.min(best, Math.hypot((o.geometry[j][0] - p[0]) * k, o.geometry[j][1] - p[1]))
  return best
}

/**
 * A storm on one route only: placed near `share` of the way along, at the spot
 * farthest from the other routes, sized to that gap, and peaking when the truck gets there.
 */
function onRoute(r: ScenarioRoute, others: ScenarioRoute[], share: number, cell: Omit<Cell, 'lng' | 'lat' | 'dLng' | 'dLat' | 'peakHour' | 'radius'>): Cell {
  let bestI = 0
  let bestGap = -1
  for (let f = Math.max(0.12, share - 0.2); f <= Math.min(0.88, share + 0.2); f += 0.02) {
    const i = Math.round(f * (r.geometry.length - 1))
    const gap = gapTo(r.geometry[i], others)
    if (gap > bestGap) ((bestGap = gap), (bestI = i))
  }
  const [lng, lat] = r.geometry[bestI]
  // Gaussian falloff: at ~2.5 radii the cell is under 5% strength, so it stays off the neighbours.
  return { lng, lat, dLng: 0, dLat: 0, peakHour: r.geometry_times_s[bestI] / 3600, radius: Math.min(0.3, bestGap / 2.5), ...cell }
}

/** Storm cells placed relative to the trip (bounding box or the routes themselves), so any fixture gets them. */
function cellsFor(id: ScenarioId, bbox: [number, number, number, number], routes: ScenarioRoute[]): Cell[] {
  const [w, s, e, n] = bbox
  const cx = (w + e) / 2
  const cy = (s + n) / 2
  const span = Math.max(e - w, n - s)
  const at = (fx: number, fy: number) => ({ lng: w + (e - w) * fx, lat: s + (n - s) * fy })
  switch (id) {
    case 'rain_band':
      // One band sweeping east: crosses the western route early and the coast later, so departure time matters.
      return [
        { ...at(-0.15, 0.35), dLng: span / 22, dLat: 0.01, radius: span * 0.11, peakHour: 10, spanHours: 26, rain: 0.62, wind: 22 },
        { ...at(-0.2, 0.7), dLng: span / 22, dLat: 0.01, radius: span * 0.08, peakHour: 13, spanHours: 20, rain: 0.35 },
      ]
    case 'wind_heavy_load':
      return [{ lng: cx, lat: cy, dLng: span / 60, dLat: 0, radius: span * 0.35, peakHour: 10, spanHours: 40, wind: 48 }]
    case 'mountain_snow':
      return [
        { ...at(0.35, 0.55), dLng: 0.01, dLat: 0, radius: span * 0.18, peakHour: 14, spanHours: 26, snow: 2.4, wind: 28 },
        { ...at(0.7, 0.45), dLng: 0.01, dLat: 0, radius: span * 0.12, peakHour: 20, spanHours: 20, snow: 1.3 },
      ]
    case 'blowout':
      return [{ ...at(0.55, 0.7), dLng: 0, dLat: 0, radius: span * 0.12, peakHour: 6, spanHours: 30, wind: 62 }]
    case 'mixed': {
      // Every state in one trip, timed to the default departure:
      // the slowest route stays usable (Moderate), the fastest meets Severe rain
      // and High snow, the middle one a 50 mph wind that the load rule makes No Travel.
      const [fast, middle, slow] = [...routes].sort((a, b) => a.duration_s - b.duration_s)
      const cells: Cell[] = []
      const others = (r: ScenarioRoute) => routes.filter((o) => o !== r)
      if (fast) cells.push(onRoute(fast, others(fast), 0.45, { spanHours: 9, rain: 0.8, wind: 20 }), onRoute(fast, others(fast), 0.25, { spanHours: 8, snow: 1.5 }))
      if (middle) cells.push(onRoute(middle, others(middle), 0.6, { spanHours: 10, wind: 52 }))
      if (slow) cells.push(onRoute(slow, others(slow), 0.5, { spanHours: 8, wind: 30 }), onRoute(slow, others(slow), 0.78, { spanHours: 6, rain: 0.16 }))
      return cells
    }
    default:
      return []
  }
}

/**
 * Weather as a function of place and track hour. Storm timing is relative to
 * the departure (`departureHour` on the track), so the same trip always meets
 * the same weather, whatever the clock says.
 */
export function makeField(id: ScenarioId, bbox: [number, number, number, number], routes: ScenarioRoute[], departureHour: number) {
  const cells = cellsFor(id, bbox, routes).map((c) => ({ ...c, peakHour: c.peakHour + departureHour }))
  return (lng: number, lat: number, hour: number): Weather => {
    // Light background breeze that varies a little with place and time.
    let wind = 8 + 4 * Math.sin(lng * 0.7 + hour / 6) + 3 * Math.cos(lat * 0.9)
    let rain = 0
    let snow = 0
    for (const c of cells) {
      const x = c.lng + c.dLng * (hour - departureHour)
      const y = c.lat + c.dLat * (hour - departureHour)
      const d2 = ((lng - x) * Math.cos((lat * Math.PI) / 180)) ** 2 + (lat - y) ** 2
      const space = Math.exp(-d2 / (2 * c.radius * c.radius))
      const time = Math.exp(-(((hour - c.peakHour) / (c.spanHours / 2)) ** 2))
      const k = space * time
      if (c.wind) wind = Math.max(wind, c.wind * k + wind * (1 - k))
      if (c.rain) rain += c.rain * k
      if (c.snow) snow += c.snow * k
    }
    return { wind, gust: wind * 1.35, rain, snow }
  }
}

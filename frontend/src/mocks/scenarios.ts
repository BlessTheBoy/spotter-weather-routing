// Synthetic weather for the mock backend: a few moving storm cells laid over a
// calm background, so every risk level, element and the load rules can be seen.

export type ScenarioId = 'live' | 'calm' | 'rain_band' | 'wind_heavy_load' | 'mountain_snow' | 'blowout' | 'mixed'

export const SCENARIOS: { id: ScenarioId; label: string; hint: string }[] = [
  { id: 'live', label: 'Recorded forecast', hint: 'The real forecast captured when the fixture was made' },
  { id: 'calm', label: 'Calm', hint: 'Everything Low' },
  { id: 'rain_band', label: 'Rain band', hint: 'A heavy rain line sweeps east across the routes' },
  { id: 'wind_heavy_load', label: 'High wind', hint: '35–50 mph wind; try loads above 30k and 40k lb' },
  { id: 'mountain_snow', label: 'Mountain snow', hint: 'Snow over the high ground, worst overnight' },
  { id: 'blowout', label: 'No Travel', hint: 'A 60 mph wind storm sits on one route' },
  { id: 'mixed', label: 'Mixed', hint: 'Rain, wind and snow cells at once' },
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
  /** Radius in degrees, peak hour (from track start) and duration in hours. */
  radius: number
  peakHour: number
  spanHours: number
  wind?: number
  rain?: number
  snow?: number
}

/** Storm cells placed relative to the trip's bounding box, so any fixture gets them. */
function cellsFor(id: ScenarioId, bbox: [number, number, number, number]): Cell[] {
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
    case 'mixed':
      return [
        { ...at(0.15, 0.3), dLng: span / 25, dLat: 0.01, radius: span * 0.13, peakHour: 9, spanHours: 26, rain: 0.7 },
        { ...at(0.6, 0.65), dLng: 0, dLat: 0, radius: span * 0.12, peakHour: 12, spanHours: 30, wind: 47 },
        { ...at(0.4, 0.8), dLng: 0.01, dLat: -0.01, radius: span * 0.1, peakHour: 18, spanHours: 24, snow: 2.2 },
      ]
    default:
      return []
  }
}

export function makeField(id: ScenarioId, bbox: [number, number, number, number]) {
  const cells = cellsFor(id, bbox)
  return (lng: number, lat: number, hour: number): Weather => {
    // Light background breeze that varies a little with place and time.
    let wind = 8 + 4 * Math.sin(lng * 0.7 + hour / 6) + 3 * Math.cos(lat * 0.9)
    let rain = 0
    let snow = 0
    for (const c of cells) {
      const x = c.lng + c.dLng * hour
      const y = c.lat + c.dLat * hour
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

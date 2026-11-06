// Turns a recorded route fixture plus a weather scenario into a v2 Plan, doing
// in TypeScript what the Django planner will do: checkpoints for every
// interval, hourly weather and risk per checkpoint, and the recommendation for
// every departure hour the pin can reach.
import type { Checkpoint, CheckpointSeries, Corridor, DepartureOption, Interval, Level, LngLat, Plan, PlanRequest, Route, RouteSummary, Timeline } from '@/api/types'
import { INTERVALS } from '@/api/types'
import { seriesIndex } from '@/lib/plan'
import { checkpointsAlong, syntheticInstructions } from './geometry'
import { loadLevel, rainLevel, recommend, snowLevel, summarize, windLevel } from './rules'
import { makeField, type ScenarioId, type Weather } from './scenarios'

/** The parts of a recorded /api/plan response (backend/fixtures) the demo replays. */
export interface Fixture {
  routes: {
    id: string
    label: string
    provider: string
    distance_mi: number
    duration_s: number
    geometry: LngLat[]
    geometry_times_s: number[]
    via?: string | null
    instructions?: Route['instructions']
  }[]
  corridor: { resolution: number; hours: string[]; cells: Corridor['cells']; wind_mph: number[]; rain_in_hr: number[]; snow_in_hr: number[] }
}

const HOUR = 3600_000
const TRACK_HOURS = 48
const iso = (ms: number) => new Date(ms).toISOString()
const floorHour = (ms: number) => Math.floor(ms / HOUR) * HOUR

/** The recorded forecast as a field: nearest corridor cell, nearest recorded hour. */
function recordedField(fx: Fixture, trackStart: number) {
  const { cells, hours } = fx.corridor
  const t0 = Date.parse(hours[0])
  const n = cells.length
  return (lng: number, lat: number, hour: number): Weather => {
    let best = 0
    let bestD = Infinity
    for (let i = 0; i < n; i++) {
      const [x, y] = cells[i].center
      const d = (x - lng) ** 2 + (y - lat) ** 2
      if (d < bestD) ((bestD = d), (best = i))
    }
    const h = Math.min(hours.length - 1, Math.max(0, Math.round((trackStart + hour * HOUR - t0) / HOUR)))
    const wind = fx.corridor.wind_mph[h * n + best]
    return { wind, gust: wind * 1.35, rain: fx.corridor.rain_in_hr[h * n + best], snow: fx.corridor.snow_in_hr[h * n + best] }
  }
}

function bboxOf(fx: Fixture): [number, number, number, number] {
  let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity]
  for (const r of fx.routes) for (const [x, y] of r.geometry) ((w = Math.min(w, x)), (s = Math.min(s, y)), (e = Math.max(e, x)), (n = Math.max(n, y)))
  return [w, s, e, n]
}

function timelineFor(departureMs: number, longestS: number): Timeline {
  const now = Date.now()
  const nowHour = floorHour(now)
  const longest = Math.ceil(longestS / 3600) * HOUR
  // As much history before the departure as fits, up to 24 h, while keeping the whole longest trip on the track.
  const back = Math.max(0, Math.min(24 * HOUR, TRACK_HOURS * HOUR - longest - 2 * HOUR))
  const start = Math.max(nowHour, floorHour(departureMs) - back)
  const end = start + TRACK_HOURS * HOUR
  const departureMin = Math.max(now, start)
  const departureMax = Math.max(departureMin, end - longest)
  return {
    now: iso(now),
    start: iso(start),
    end: iso(end),
    departure: iso(Math.min(Math.max(departureMs, departureMin), departureMax)),
    departure_min: iso(departureMin),
    departure_max: iso(departureMax),
    long_range_after: iso(now + 72 * HOUR),
    series_start: iso(start),
  }
}

function seriesFor(field: (lng: number, lat: number, h: number) => Weather, lng: number, lat: number, hours: number, loadLb: number): CheckpointSeries {
  const s: CheckpointSeries = { wind_mph: [], gust_mph: [], rain_in_hr: [], snow_in_hr: [], level: [], wind_level: [], rain_level: [], snow_level: [], load_level: [] }
  for (let h = 0; h < hours; h++) {
    const w = field(lng, lat, h)
    const wl = windLevel(w.wind)
    const rl = rainLevel(w.rain)
    const sl = snowLevel(w.snow)
    const ll = loadLevel(w.wind, loadLb)
    s.wind_mph.push(Math.round(w.wind * 10) / 10)
    s.gust_mph.push(Math.round(w.gust * 10) / 10)
    s.rain_in_hr.push(Math.round(w.rain * 1000) / 1000)
    s.snow_in_hr.push(Math.round(w.snow * 1000) / 1000)
    s.wind_level.push(wl)
    s.rain_level.push(rl)
    s.snow_level.push(sl)
    s.load_level.push(ll)
    s.level.push(Math.max(wl, rl, sl, ll) as Level)
  }
  return s
}

export function buildPlan(fx: Fixture, req: PlanRequest, scenario: ScenarioId): Plan {
  const longest = Math.max(...fx.routes.map((r) => r.duration_s))
  const timeline = timelineFor(Date.parse(req.departure), longest)
  const trackStart = Date.parse(timeline.start)
  const seriesHours = TRACK_HOURS + Math.ceil(longest / 3600) + 2
  const departureHour = (Date.parse(timeline.departure) - trackStart) / HOUR
  const field = scenario === 'live' ? recordedField(fx, trackStart) : makeField(scenario, bboxOf(fx), fx.routes, departureHour)

  const routes: Route[] = fx.routes.map((r) => {
    const checkpoints = {} as Record<Interval, Checkpoint[]>
    for (const interval of INTERVALS) {
      checkpoints[interval] = checkpointsAlong(r.geometry, r.geometry_times_s, interval, r.distance_mi).map((cp) => ({
        ...cp,
        series: seriesFor(field, cp.lng, cp.lat, seriesHours, req.load_lb),
      }))
    }
    return {
      id: r.id,
      label: r.label,
      via: r.via ?? null,
      provider: r.provider,
      notes: [],
      distance_mi: r.distance_mi,
      duration_s: r.duration_s,
      geometry: r.geometry,
      geometry_times_s: r.geometry_times_s,
      // Real TomTom guidance when the recording has it; a rough stand-in otherwise.
      instructions: r.instructions?.length ? r.instructions : syntheticInstructions(r.geometry, r.distance_mi),
      checkpoints,
    }
  })

  const schedule = {} as Record<Interval, DepartureOption[]>
  const depMin = Date.parse(timeline.departure_min)
  const depMax = Date.parse(timeline.departure_max)
  const dep0 = Date.parse(timeline.departure)
  // Hourly steps anchored on the entered departure, both directions, inside the pin limits.
  const departures: number[] = []
  for (let t = dep0; t >= depMin; t -= HOUR) departures.unshift(t)
  for (let t = dep0 + HOUR; t <= depMax; t += HOUR) departures.push(t)
  for (const interval of INTERVALS) {
    schedule[interval] = departures.map((dep) => {
      const summaries: Record<string, RouteSummary> = {}
      for (const r of routes) {
        summaries[r.id] = summarize(
          r.checkpoints[interval].map((cp) => ({ level: cp.series.level[Math.min(seriesHours - 1, seriesIndex(timeline, dep, cp.eta_offset_s))], miles: cp.represents_mi })),
        )
      }
      const recommendation = recommend(routes.map((r) => ({ id: r.id, label: r.label, summary: summaries[r.id], duration_s: r.duration_s })))
      return { departure: iso(dep), summaries, recommendation }
    })
  }

  const cells = fx.corridor.cells
  const corridor: Corridor = { resolution: fx.corridor.resolution, hours: [], cells, risk: [], wind_mph: [], rain_in_hr: [], snow_in_hr: [] }
  for (let h = 0; h <= TRACK_HOURS; h++) {
    corridor.hours.push(iso(trackStart + h * HOUR))
    for (const c of cells) {
      const w = field(c.center[0], c.center[1], h)
      corridor.wind_mph.push(Math.round(w.wind * 10) / 10)
      corridor.rain_in_hr.push(Math.round(w.rain * 1000) / 1000)
      corridor.snow_in_hr.push(Math.round(w.snow * 1000) / 1000)
      corridor.risk.push(Math.max(windLevel(w.wind), rainLevel(w.rain), snowLevel(w.snow), loadLevel(w.wind, req.load_lb)))
    }
  }

  return {
    generated_at: iso(Date.now()),
    origin: req.origin,
    destination: req.destination,
    stops: req.stops,
    load_lb: req.load_lb,
    timeline,
    routes,
    schedule,
    corridor,
  }
}

// Read-side helpers over a v2 Plan: what every route looks like for the
// departure the pin is on. No risk logic here; levels come precomputed.
import type { Checkpoint, DepartureOption, Interval, Level, Plan, Route, Timeline } from '@/api/types'

const HOUR = 3600_000

export interface CheckpointState {
  index: number
  mile: number
  lng: number
  lat: number
  eta: number
  represents_mi: number
  level: Level | null
  wind: number
  gust: number
  rain: number
  snow: number
  windLevel: Level
  rainLevel: Level
  snowLevel: Level
  loadLevel: Level
}

export function seriesIndex(timeline: Timeline, departureMs: number, etaOffsetS: number): number {
  return Math.round((departureMs + etaOffsetS * 1000 - Date.parse(timeline.series_start)) / HOUR)
}

export function checkpointState(timeline: Timeline, cp: Checkpoint, index: number, departureMs: number): CheckpointState {
  const i = seriesIndex(timeline, departureMs, cp.eta_offset_s)
  const s = cp.series
  const ok = i >= 0 && i < s.level.length
  const at = <T,>(arr: T[], fallback: T) => (ok ? arr[i] : fallback)
  return {
    index,
    mile: cp.mile,
    lng: cp.lng,
    lat: cp.lat,
    eta: departureMs + cp.eta_offset_s * 1000,
    represents_mi: cp.represents_mi,
    level: ok ? s.level[i] : null,
    wind: at(s.wind_mph, 0),
    gust: at(s.gust_mph, 0),
    rain: at(s.rain_in_hr, 0),
    snow: at(s.snow_in_hr, 0),
    windLevel: at(s.wind_level, 0 as Level),
    rainLevel: at(s.rain_level, 0 as Level),
    snowLevel: at(s.snow_level, 0 as Level),
    loadLevel: at(s.load_level, 0 as Level),
  }
}

export function routeStates(plan: Plan, route: Route, interval: Interval, departureMs: number): CheckpointState[] {
  return route.checkpoints[interval].map((cp, i) => checkpointState(plan.timeline, cp, i, departureMs))
}

/** The schedule entry for the pin's departure (nearest hour step). */
export function optionAt(plan: Plan, interval: Interval, departureMs: number): DepartureOption {
  const opts = plan.schedule[interval]
  let best = opts[0]
  for (const o of opts) if (Math.abs(Date.parse(o.departure) - departureMs) < Math.abs(Date.parse(best.departure) - departureMs)) best = o
  return best
}

export function departureSteps(plan: Plan): number[] {
  return plan.schedule[10].map((o) => Date.parse(o.departure))
}

/** Elements at High or worse, for map badges. */
export function badgeOf(s: CheckpointState): { level: Level; elements: string } | null {
  const parts: [string, Level][] = [
    ['w', Math.max(s.windLevel, s.loadLevel) as Level],
    ['r', s.rainLevel],
    ['s', s.snowLevel],
  ]
  const hot = parts.filter(([, l]) => l >= 2)
  if (!hot.length || s.level == null || s.level < 2) return null
  return { level: s.level, elements: hot.map(([k]) => k).join('') }
}

export function isNow(departureMs: number): boolean {
  return Math.abs(departureMs - Date.now()) < 45 * 60_000
}

/**
 * Forecast view: the same checkpoints, but every value read at one fixed
 * moment (the forecast playhead) instead of at each checkpoint's ETA.
 */
export function routeStatesAtTime(plan: Plan, route: Route, interval: Interval, departureMs: number, timeMs: number): CheckpointState[] {
  const i = Math.round((timeMs - Date.parse(plan.timeline.series_start)) / HOUR)
  return route.checkpoints[interval].map((cp, index) => {
    const s = cp.series
    const ok = i >= 0 && i < s.level.length
    return {
      index,
      mile: cp.mile,
      lng: cp.lng,
      lat: cp.lat,
      eta: departureMs + cp.eta_offset_s * 1000,
      represents_mi: cp.represents_mi,
      level: ok ? s.level[i] : null,
      wind: ok ? s.wind_mph[i] : 0,
      gust: ok ? s.gust_mph[i] : 0,
      rain: ok ? s.rain_in_hr[i] : 0,
      snow: ok ? s.snow_in_hr[i] : 0,
      windLevel: ok ? s.wind_level[i] : 0,
      rainLevel: ok ? s.rain_level[i] : 0,
      snowLevel: ok ? s.snow_level[i] : 0,
      loadLevel: ok ? s.load_level[i] : 0,
    }
  })
}

/** Worst level on the pick for every departure the pin can take: the "when should I leave" lane. */
export function departureOutlook(plan: Plan, interval: Interval): { departure: number; worst: Level; routeId: string }[] {
  return plan.schedule[interval].map((o) => ({
    departure: Date.parse(o.departure),
    routeId: o.recommendation.route_id,
    worst: o.summaries[o.recommendation.route_id].max_level,
  }))
}

/** The longest run of consecutive departures sharing the best (lowest) worst-level. */
export function bestWindow(plan: Plan, interval: Interval): { from: number; to: number; worst: Level } | null {
  const lane = departureOutlook(plan, interval)
  if (!lane.length) return null
  const best = Math.min(...lane.map((d) => d.worst)) as Level
  let run: { from: number; to: number } | null = null
  let top: { from: number; to: number } | null = null
  for (const d of lane) {
    if (d.worst === best) {
      run = run ? { from: run.from, to: d.departure } : { from: d.departure, to: d.departure }
      if (!top || run.to - run.from > top.to - top.from) top = { ...run }
    } else run = null
  }
  return top ? { ...top, worst: best } : null
}

/** First departure (from the pin onward, then earlier) where some route has no No Travel miles. */
export function safeAlternatives(plan: Plan, interval: Interval, routeId: string, departureMs: number) {
  const opt = optionAt(plan, interval, departureMs)
  const otherRoute = opt.recommendation.ranking.find((id) => id !== routeId && opt.summaries[id].miles_by_level.no_travel === 0) ?? null
  const later = plan.schedule[interval].find((o) => Date.parse(o.departure) > departureMs && o.summaries[routeId].miles_by_level.no_travel === 0)
  return { otherRoute, laterDeparture: later ? Date.parse(later.departure) : null }
}

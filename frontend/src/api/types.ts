// Plan contract v2. The Django /api/plan response will match this; until the
// UX is signed off it is produced by src/mocks.

export type LngLat = [number, number]

export interface Place {
  label: string
  lat: number
  lng: number
}

export type Interval = 10 | 25 | 50
export const INTERVALS: Interval[] = [10, 25, 50]

/** 0 Low, 1 Moderate, 2 High, 3 Severe, 4 No Travel. */
export type Level = 0 | 1 | 2 | 3 | 4

/**
 * Hourly values on the plan's shared time axis (`timeline.series_start`, one
 * entry per hour). A checkpoint's weather for a given departure is the entry at
 * the hour the truck reaches it.
 */
export interface CheckpointSeries {
  wind_mph: number[]
  gust_mph: number[]
  rain_in_hr: number[]
  snow_in_hr: number[]
  /** Final level (worst of wind, rain, snow and the load rules). */
  level: Level[]
  wind_level: Level[]
  rain_level: Level[]
  snow_level: Level[]
  load_level: Level[]
}

export interface Checkpoint {
  mile: number
  lng: number
  lat: number
  eta_offset_s: number
  represents_mi: number
  series: CheckpointSeries
}

export interface Instruction {
  /** Distance from the route start where the manoeuvre happens. */
  mile: number
  maneuver: 'depart' | 'straight' | 'left' | 'right' | 'slight_left' | 'slight_right' | 'arrive'
  text: string
  road: string | null
}

export interface Route {
  id: string
  label: string
  via: string | null
  provider: string
  notes: string[]
  distance_mi: number
  duration_s: number
  geometry: LngLat[]
  geometry_times_s: number[]
  instructions: Instruction[]
  checkpoints: Record<Interval, Checkpoint[]>
}

export interface RouteSummary {
  miles_by_level: Record<'low' | 'moderate' | 'high' | 'severe' | 'no_travel', number>
  average_risk: number
  max_level: Level
}

export type Criterion = 'no_travel_miles' | 'severe_miles' | 'high_miles' | 'average_risk' | 'travel_time'

export interface Recommendation {
  route_id: string
  ranking: string[]
  deciding_criterion: Criterion | null
  reason: string
}

/** Everything that changes when the departure pin moves, for one departure hour. */
export interface DepartureOption {
  departure: string
  summaries: Record<string, RouteSummary>
  recommendation: Recommendation
}

export interface Timeline {
  now: string
  /** Start of the 48 h forecast track. */
  start: string
  end: string
  /** The departure the user entered (pin's initial position). */
  departure: string
  /** Pin limits: the longest route must still finish before `end`. */
  departure_min: string
  departure_max: string
  /** Forecasts past this point get a long-range note. */
  long_range_after: string
  /** Hour 0 of every checkpoint series. */
  series_start: string
}

export interface Corridor {
  resolution: number
  /** One entry per track hour, `timeline.start` … `timeline.end`. */
  hours: string[]
  cells: { id: string; center: LngLat; boundary: LngLat[] }[]
  /** Flattened [hour * cells.length + cell]. */
  risk: number[]
  wind_mph: number[]
  rain_in_hr: number[]
  snow_in_hr: number[]
}

export interface Plan {
  generated_at: string
  origin: Place
  destination: Place
  stops: Place[]
  load_lb: number
  timeline: Timeline
  routes: Route[]
  /** Keyed by interval, then one option per departure hour from departure_min to departure_max. */
  schedule: Record<Interval, DepartureOption[]>
  corridor: Corridor
}

export interface PlanRequest {
  origin: Place
  destination: Place
  stops: Place[]
  departure: string
  load_lb: number
}

// Mirrors the Django /api/plan response.

export type LngLat = [number, number]

export interface Place {
  label: string
  lat: number
  lng: number
}

export interface CheckpointWeather {
  forecast_hour: string
  wind_mph: number
  gust_mph: number
  rain_in_hr: number
  snow_in_hr: number
}

export interface Checkpoint {
  mile: number
  lng: number
  lat: number
  eta: string
  eta_offset_s: number
  represents_mi: number
  /** 0 Low … 4 No Travel; null when the ETA is past the forecast horizon. */
  level: number | null
  drivers: string[]
  levels?: Record<'wind' | 'rain' | 'snow' | 'load', string>
  weather: CheckpointWeather | null
}

export interface RouteSummary {
  miles_by_level: Record<'low' | 'moderate' | 'high' | 'severe' | 'no_travel', number>
  average_risk: number
  max_level: number
}

export interface Route {
  id: string
  label: string
  provider: string
  forced_via: LngLat | null
  notes: string[]
  distance_mi: number
  duration_s: number
  departure: string
  arrival: string
  geometry: LngLat[]
  geometry_times_s: number[]
  summary: RouteSummary
  checkpoints: Checkpoint[]
}

export type Criterion = 'no_travel_miles' | 'severe_miles' | 'high_miles' | 'average_risk' | 'travel_time'

export interface Corridor {
  resolution: number
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
  departure: string
  departure_adjusted: boolean
  load_lb: number
  interval_mi: number
  routes: Route[]
  recommendation: {
    route_id: string
    ranking: string[]
    deciding_criterion: Criterion | null
    reason: string
  }
  corridor: Corridor
}

export interface PlanRequest {
  origin: Place
  destination: Place
  departure: string
  load_lb: number
  interval_mi: 10 | 25 | 50
}

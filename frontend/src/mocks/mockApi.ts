// Mock backend for UX work: replays recorded /api/plan responses with every
// timestamp shifted so the trip departs when the user asked. Enabled with
// VITE_API_MOCK=1; loaded lazily so fixtures never ship in a real build.
import type { Place, Plan, PlanRequest } from '../api/types'

const FIXTURES = {
  'charlotte-new-york': () => import('./fixtures/plan-charlotte-new-york.json'),
  'denver-salt-lake-city': () => import('./fixtures/plan-denver-salt-lake-city.json'),
}

const PLACES: Place[] = [
  { label: 'Charlotte, North Carolina, US', lat: 35.2272, lng: -80.8431 },
  { label: 'New York, New York, US', lat: 40.7128, lng: -74.006 },
  { label: 'Denver, Colorado, US', lat: 39.7392, lng: -104.9903 },
  { label: 'Salt Lake City, Utah, US', lat: 40.7608, lng: -111.891 },
  { label: 'Dallas, Texas, US', lat: 32.7767, lng: -96.797 },
  { label: 'Chicago, Illinois, US', lat: 41.8781, lng: -87.6298 },
  { label: 'Atlanta, Georgia, US', lat: 33.749, lng: -84.388 },
]

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function mockSearchPlaces(q: string): Promise<Place[]> {
  await delay(120)
  const needle = q.toLowerCase()
  return PLACES.filter((p) => p.label.toLowerCase().includes(needle))
}

/** East of the Mississippi gets the rainy Charlotte→NYC trip, west gets Denver→SLC. */
function pickFixture(req: PlanRequest): keyof typeof FIXTURES {
  return req.origin.lng > -90 ? 'charlotte-new-york' : 'denver-salt-lake-city'
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/

function shift<T>(value: T, ms: number): T {
  if (typeof value === 'string' && ISO.test(value)) return new Date(Date.parse(value) + ms).toISOString() as T
  if (Array.isArray(value)) return (value.length && typeof value[0] === 'number' ? value : value.map((v) => shift(v, ms))) as T
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shift(v, ms)])) as T
  return value
}

export async function mockFetchPlan(req: PlanRequest): Promise<Plan> {
  const raw = (await FIXTURES[pickFixture(req)]()).default as unknown as Plan
  await delay(900) // feel like a real network round trip
  // Keep the forecast window anchored on the current hour, and the trip on the requested departure.
  const hourNow = new Date()
  hourNow.setUTCMinutes(0, 0, 0)
  const corridorShift = hourNow.getTime() - Date.parse(raw.corridor.hours[0])
  const plan = shift(raw, corridorShift)
  const tripShift = Date.parse(req.departure) - Date.parse(plan.departure)
  return {
    ...plan,
    load_lb: req.load_lb,
    interval_mi: req.interval_mi,
    routes: plan.routes.map((r) => shift(r, tripShift)),
    departure: req.departure,
  }
}

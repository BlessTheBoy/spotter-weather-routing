// Mock backend for UX work (VITE_API_MOCK=1): recorded routes plus a chosen
// weather scenario, built into a v2 Plan in the browser. Loaded lazily so
// fixtures never ship in a real build.
import type { Place, Plan, PlanRequest } from '../api/types'
import { buildPlan, type Fixture } from './buildPlan'
import type { ScenarioId } from './scenarios'

const FIXTURES = {
  'charlotte-new-york': () => import('./fixtures/plan-charlotte-new-york.json'),
  'denver-salt-lake-city': () => import('./fixtures/plan-denver-salt-lake-city.json'),
}

const PLACES: Place[] = [
  { label: 'Charlotte, North Carolina, US', lat: 35.2272, lng: -80.8431 },
  { label: 'New York, New York, US', lat: 40.7128, lng: -74.006 },
  { label: 'Denver, Colorado, US', lat: 39.7392, lng: -104.9903 },
  { label: 'Salt Lake City, Utah, US', lat: 40.7608, lng: -111.891 },
  { label: 'Richmond, Virginia, US', lat: 37.5407, lng: -77.436 },
  { label: 'Grand Junction, Colorado, US', lat: 39.0639, lng: -108.5506 },
  { label: 'Chicago, Illinois, US', lat: 41.8781, lng: -87.6298 },
]

const SCENARIO_KEY = 'mock-scenario'
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function getScenario(): ScenarioId {
  try {
    return (localStorage.getItem(SCENARIO_KEY) as ScenarioId) || 'rain_band'
  } catch {
    return 'rain_band'
  }
}

export function setScenario(id: ScenarioId) {
  try {
    localStorage.setItem(SCENARIO_KEY, id)
  } catch {
    /* private mode: scenario just won't persist */
  }
}

export async function mockSearchPlaces(q: string): Promise<Place[]> {
  await delay(120)
  const needle = q.toLowerCase()
  return PLACES.filter((p) => p.label.toLowerCase().includes(needle))
}

/** East of the Mississippi replays Charlotte→NYC, west replays Denver→SLC. */
function pickFixture(req: PlanRequest): keyof typeof FIXTURES {
  return req.origin.lng > -90 ? 'charlotte-new-york' : 'denver-salt-lake-city'
}

export async function mockFetchPlan(req: PlanRequest): Promise<Plan> {
  const fx = (await FIXTURES[pickFixture(req)]()).default as unknown as Fixture
  await delay(700)
  return buildPlan(fx, req, getScenario())
}

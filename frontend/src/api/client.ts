import { getDataMode } from '@/lib/dataMode'
import type { Place, Plan, PlanRequest } from './types'

const BASE = import.meta.env.VITE_API_BASE ?? ''

export class ApiError extends Error {
  /** Server error code, e.g. 'weather_quota' when live weather is out of its free allowance. */
  readonly code?: string

  constructor(message: string, code?: string) {
    super(message)
    this.code = code
  }
}

async function parse<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    // DRF validation errors come back as {field: [messages]} or {detail}.
    const detail =
      body.detail ??
      Object.values(body as Record<string, unknown>)
        .flat()
        .map((v) => (typeof v === 'object' ? Object.values(v as object).flat().join(' ') : String(v)))
        .join(' ')
    throw new ApiError(detail || `Request failed (${res.status})`, body.code)
  }
  return body as T
}

export async function searchPlaces(q: string, signal?: AbortSignal): Promise<Place[]> {
  if (getDataMode() === 'demo') return (await import('../mocks/mockApi')).mockSearchPlaces(q)
  const res = await fetch(`${BASE}/api/geocode?q=${encodeURIComponent(q)}`, { signal })
  return (await parse<{ results: Place[] }>(res)).results
}

export async function fetchPlan(req: PlanRequest, signal?: AbortSignal): Promise<Plan> {
  if (getDataMode() === 'demo') return (await import('../mocks/mockApi')).mockFetchPlan(req)
  const res = await fetch(`${BASE}/api/plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
    signal,
  })
  const plan = await parse<Plan>(res)
  // Guard against an older API build: fail with a clear message, not a broken screen.
  if (!plan.timeline || !plan.schedule || !plan.routes?.length) throw new ApiError('The live service returned an unexpected response. Try demo data, or try again shortly.')
  return plan
}

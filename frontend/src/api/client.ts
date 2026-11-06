import type { Place, Plan, PlanRequest } from './types'

const BASE = import.meta.env.VITE_API_BASE ?? ''
const MOCK = import.meta.env.VITE_API_MOCK === '1'

export class ApiError extends Error {}

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
    throw new ApiError(detail || `Request failed (${res.status})`)
  }
  return body as T
}

export async function searchPlaces(q: string, signal?: AbortSignal): Promise<Place[]> {
  if (MOCK) return (await import('../mocks/mockApi')).mockSearchPlaces(q)
  const res = await fetch(`${BASE}/api/geocode?q=${encodeURIComponent(q)}`, { signal })
  return (await parse<{ results: Place[] }>(res)).results
}

export async function fetchPlan(req: PlanRequest, signal?: AbortSignal): Promise<Plan> {
  if (MOCK) return (await import('../mocks/mockApi')).mockFetchPlan(req)
  const res = await fetch(`${BASE}/api/plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
    signal,
  })
  return parse<Plan>(res)
}

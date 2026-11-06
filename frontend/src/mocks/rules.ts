// Mock-only mirror of backend/planner/domain/{risk,recommend}.py so the UX can
// be exercised with synthetic weather. The graded logic lives in Django; keep
// these in step with it (same half-open bands, same ranking order).
import type { Criterion, Level, Recommendation, RouteSummary } from '@/api/types'

export function windLevel(mph: number): Level {
  return mph >= 55 ? 4 : mph >= 45 ? 3 : mph >= 35 ? 2 : mph >= 25 ? 1 : 0
}
export function rainLevel(inHr: number): Level {
  return inHr > 1 ? 4 : inHr >= 0.5 ? 3 : inHr >= 0.25 ? 2 : inHr >= 0.1 ? 1 : 0
}
export function snowLevel(inHr: number): Level {
  return inHr > 3 ? 4 : inHr >= 2 ? 3 : inHr >= 1 ? 2 : inHr >= 0.5 ? 1 : 0
}
export function loadLevel(windMph: number, loadLb: number): Level {
  if (windMph >= 55) return 4
  if (windMph >= 45 && loadLb > 30_000) return 4
  if (windMph >= 35 && loadLb > 40_000) return 3
  return 0
}

const KEYS = ['low', 'moderate', 'high', 'severe', 'no_travel'] as const

export function summarize(samples: { level: Level; miles: number }[]): RouteSummary {
  const miles = { low: 0, moderate: 0, high: 0, severe: 0, no_travel: 0 }
  for (const s of samples) miles[KEYS[s.level]] += s.miles
  const total = samples.reduce((a, s) => a + s.miles, 0)
  const avg = total ? samples.reduce((a, s) => a + s.level * s.miles, 0) / total : 0
  const max = samples.reduce((m, s) => Math.max(m, s.level), 0 as number) as Level
  const r1 = (x: number) => Math.round(x * 10) / 10
  return {
    miles_by_level: { low: r1(miles.low), moderate: r1(miles.moderate), high: r1(miles.high), severe: r1(miles.severe), no_travel: r1(miles.no_travel) },
    average_risk: Math.round(avg * 100) / 100,
    max_level: max,
  }
}

const CRITERIA: Criterion[] = ['no_travel_miles', 'severe_miles', 'high_miles', 'average_risk', 'travel_time']

export function recommend(rows: { id: string; label: string; summary: RouteSummary; duration_s: number }[]): Recommendation {
  const key = (r: (typeof rows)[number]) => [
    r.summary.miles_by_level.no_travel,
    r.summary.miles_by_level.severe,
    r.summary.miles_by_level.high,
    r.summary.average_risk,
    Math.round(r.duration_s / 60),
  ]
  const ranked = [...rows].sort((a, b) => {
    const ka = key(a)
    const kb = key(b)
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i]
    return 0
  })
  const [w, r] = ranked
  let deciding: Criterion | null = null
  if (r) {
    const ka = key(w)
    const kb = key(r)
    const i = ka.findIndex((v, j) => v !== kb[j])
    deciding = i >= 0 ? CRITERIA[i] : null
  }
  return { route_id: w.id, ranking: ranked.map((x) => x.id), deciding_criterion: deciding, reason: reason(w, r, deciding) }
}

function reason(w: { summary: RouteSummary; duration_s: number }, r: { label: string; summary: RouteSummary; duration_s: number } | undefined, c: Criterion | null): string {
  if (!r) return 'Only one route was found.'
  const m = w.summary.miles_by_level
  const n = r.summary.miles_by_level
  switch (c) {
    case 'no_travel_miles':
      return `Fewest No Travel miles: ${m.no_travel} vs ${n.no_travel} on ${r.label}.`
    case 'severe_miles':
      return `Fewest Severe miles: ${m.severe} vs ${n.severe} on ${r.label}.`
    case 'high_miles':
      return `Same Severe miles, fewest High miles: ${m.high} vs ${n.high} on ${r.label}.`
    case 'average_risk':
      return `Same Severe and High miles, lower average risk than ${r.label}.`
    case 'travel_time':
      return `Same risk as ${r.label} and ${Math.round((r.duration_s - w.duration_s) / 60)} min faster.`
    default:
      return `Ties ${r.label} on every measure.`
  }
}

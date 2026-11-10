export const RISK_LEVELS = [
  { level: 0, key: 'low', label: 'Low', verdict: 'Safe to run', color: '#3BB273' },
  { level: 1, key: 'moderate', label: 'Moderate', verdict: 'Monitor conditions', color: '#F2C94C' },
  { level: 2, key: 'high', label: 'High', verdict: 'Check with the driver', color: '#F2994A' },
  { level: 3, key: 'severe', label: 'Severe', verdict: 'Needs approval', color: '#EB5757' },
  { level: 4, key: 'no_travel', label: 'No Travel', verdict: 'Do not dispatch', color: '#B95BE8' },
] as const

export const UNKNOWN_COLOR = '#6B7A85'

export function riskColor(level: number | null): string {
  return level == null || level < 0 ? UNKNOWN_COLOR : RISK_LEVELS[level].color
}

export function riskLabel(level: number | null): string {
  return level == null || level < 0 ? 'No forecast' : RISK_LEVELS[level].label
}

/** What a dispatcher does about a level, in a few words. */
export function riskVerdict(level: number | null): string {
  return level == null || level < 0 ? 'No forecast yet' : RISK_LEVELS[level].verdict
}

export const CRITERIA_LABELS = {
  no_travel_miles: 'No Travel miles',
  severe_miles: 'Severe miles',
  high_miles: 'High miles',
  average_risk: 'Avg risk (0–4)',
  travel_time: 'Travel time',
} as const

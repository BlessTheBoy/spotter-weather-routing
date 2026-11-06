export const RISK_LEVELS = [
  { level: 0, key: 'low', label: 'Low', color: '#3BB273' },
  { level: 1, key: 'moderate', label: 'Moderate', color: '#F2C94C' },
  { level: 2, key: 'high', label: 'High', color: '#F2994A' },
  { level: 3, key: 'severe', label: 'Severe', color: '#EB5757' },
  { level: 4, key: 'no_travel', label: 'No Travel', color: '#B95BE8' },
] as const

export const UNKNOWN_COLOR = '#6B7A85'

export function riskColor(level: number | null): string {
  return level == null || level < 0 ? UNKNOWN_COLOR : RISK_LEVELS[level].color
}

export function riskLabel(level: number | null): string {
  return level == null || level < 0 ? 'No forecast' : RISK_LEVELS[level].label
}

export const CRITERIA_LABELS = {
  no_travel_miles: 'No Travel miles',
  severe_miles: 'Severe miles',
  high_miles: 'High miles',
  average_risk: 'Average risk',
  travel_time: 'Travel time',
} as const

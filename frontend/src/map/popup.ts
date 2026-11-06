import type { Route } from '@/api/types'
import { formatTime } from '@/lib/format'
import type { CheckpointState } from '@/lib/plan'
import { RISK_LEVELS, riskColor, riskLabel } from '@/lib/risk'

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

function row(label: string, value: string, level: number) {
  const tag = level >= 1 ? `<span class="lvl" style="--c:${RISK_LEVELS[level].color}">${RISK_LEVELS[level].label}</span>` : ''
  return `<tr><td>${label}</td><td>${value}</td><td>${tag}</td></tr>`
}

export function checkpointPopupHtml(route: Route, s: CheckpointState, loadLb: number): string {
  if (s.level == null) {
    return `<div class="cp"><div class="cp-head">${esc(route.label)} · mile ${s.mile.toFixed(0)}</div><div>No forecast this far ahead</div></div>`
  }
  const load =
    s.loadLevel > 0 && s.loadLevel >= s.windLevel
      ? `<div class="cp-note">${loadLb.toLocaleString()} lb in ${Math.round(s.wind)} mph wind raises this to ${RISK_LEVELS[s.loadLevel].label}.</div>`
      : ''
  return `
    <div class="cp">
      <div class="cp-head">${esc(route.label)} · mile ${s.mile.toFixed(0)} · ETA ${esc(formatTime(s.eta))}</div>
      <div class="cp-level" style="--c:${riskColor(s.level)}">${riskLabel(s.level)}</div>
      <table>
        ${row('Wind', `${Math.round(s.wind)} mph <span class="muted">gust ${Math.round(s.gust)}</span>`, Math.max(s.windLevel, s.loadLevel))}
        ${row('Rain', `${s.rain.toFixed(2)} in/hr`, s.rainLevel)}
        ${row('Snow', `${s.snow.toFixed(2)} in/hr`, s.snowLevel)}
      </table>
      ${load}
    </div>`
}

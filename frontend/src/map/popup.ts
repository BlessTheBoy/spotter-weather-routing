import { formatTime } from '@/lib/format'
import type { CheckpointState } from '@/lib/plan'
import { RISK_LEVELS, riskColor, riskLabel, riskVerdict } from '@/lib/risk'

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

/** A reading, coloured when it is what set the checkpoint's level. Zero readings are left out. */
function row(label: string, value: string, level: number, overall: number) {
  const style = level >= 1 && level === overall ? ` class="hot" style="--c:${RISK_LEVELS[level].color}"` : ''
  return `<tr><td>${label}</td><td${style}>${value}</td></tr>`
}

export function checkpointPopupHtml(s: CheckpointState, loadLb: number): string {
  const head = `<div class="cp-head">Mile ${s.mile.toFixed(0)} · ${esc(formatTime(s.eta))}</div>`
  if (s.level == null) return `<div class="cp">${head}<div>No forecast this far ahead</div></div>`
  const load = s.loadLevel > 0 && s.loadLevel > s.windLevel ? `<div class="cp-note">${loadLb.toLocaleString()} lb load raises wind risk to ${RISK_LEVELS[s.loadLevel].label}</div>` : ''
  const rows = [
    s.wind > 0 || s.gust > 0 ? row('Wind', `${Math.round(s.wind)} mph <span class="muted">gust ${Math.round(s.gust)}</span>`, Math.max(s.windLevel, s.loadLevel), s.level) : '',
    s.rain > 0 ? row('Rain', `${s.rain.toFixed(2)} in/hr`, s.rainLevel, s.level) : '',
    s.snow > 0 ? row('Snow', `${s.snow.toFixed(2)} in/hr`, s.snowLevel, s.level) : '',
  ].join('')
  return `
    <div class="cp">
      ${head}
      <div class="cp-level" style="--c:${riskColor(s.level)}">${riskLabel(s.level)} <span class="muted">· ${riskVerdict(s.level)}</span></div>
      ${rows ? `<table>${rows}</table>` : ''}
      ${load}
    </div>`
}

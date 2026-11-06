import type { Checkpoint, Route } from '../api/types'
import { formatTime } from '../lib/format'
import { riskColor, riskLabel } from '../lib/risk'

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

export function checkpointPopupHtml(route: Route, cp: Checkpoint): string {
  const w = cp.weather
  const why = cp.drivers.length ? ` · ${esc(cp.drivers.join(' + '))}` : ''
  const rows = w
    ? `<tr><td>Wind</td><td>${w.wind_mph} mph <span class="muted">gust ${w.gust_mph}</span></td></tr>
       <tr><td>Rain</td><td>${w.rain_in_hr.toFixed(2)} in/hr</td></tr>
       <tr><td>Snow</td><td>${w.snow_in_hr.toFixed(2)} in/hr</td></tr>`
    : '<tr><td colspan="2">No forecast this far ahead</td></tr>'
  return `
    <div class="cp">
      <div class="cp-head">${esc(route.label)} · mile ${cp.mile.toFixed(0)}</div>
      <div class="cp-level" style="--c:${riskColor(cp.level)}">${riskLabel(cp.level)}${why}</div>
      <div class="cp-eta">ETA ${esc(formatTime(cp.eta))}</div>
      <table>${rows}</table>
    </div>`
}

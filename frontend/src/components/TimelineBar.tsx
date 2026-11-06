import { CalendarCheckIcon, PauseIcon, PlayIcon, Undo2Icon } from 'lucide-react'
import { useRef, type PointerEvent as ReactPointerEvent } from 'react'
import type { Interval, Plan } from '@/api/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useForecastHour, usePlaying, type Clock } from '@/lib/clock'
import { LAYERS, type Layer } from '@/lib/forecast'
import { formatTime } from '@/lib/format'
import { bestWindow, departureOutlook } from '@/lib/plan'
import { RISK_LEVELS, riskColor } from '@/lib/risk'
import { cn } from '@/lib/utils'

const HOUR = 3600_000

export type MapClock = 'trip' | 'forecast'

interface Props {
  plan: Plan
  interval: Interval
  clock: Clock
  mapClock: MapClock
  onMapClockChange: (c: MapClock) => void
  departureMs: number
  onDepartureChange: (ms: number) => void
  tripDurationS: number
  layer: Layer
  onLayerChange: (l: Layer) => void
  showHeatmap: boolean
  onShowHeatmapChange: (on: boolean) => void
  compact?: boolean
}

/**
 * Two lanes on one 48 h scale.
 * Leave lane: when you set off. Tinted by how bad the safest route is for each departure hour.
 * Forecast lane: the clock for "Forecast view". Grabbing it or pressing Play switches the map to that hour.
 */
export function TimelineBar(props: Props) {
  const { plan, interval, clock, mapClock, onMapClockChange, departureMs, onDepartureChange, tripDurationS, layer, onLayerChange, showHeatmap, onShowHeatmapChange, compact } = props
  const hour = useForecastHour(clock)
  const playing = usePlaying(clock)
  const leaveRef = useRef<HTMLDivElement>(null)
  const forecastRef = useRef<HTMLDivElement>(null)
  const t = plan.timeline
  const start = Date.parse(t.start)
  const span = Date.parse(t.end) - start
  const pct = (ms: number) => `${Math.min(100, Math.max(0, ((ms - start) / span) * 100))}%`
  const now = Date.parse(t.now)
  const outlook = departureOutlook(plan, interval)
  const steps = outlook.map((d) => d.departure)
  const best = bestWindow(plan, interval)
  // Only suggest a window when leaving at the pin is worse than the best you could do.
  const currentWorst = outlook.reduce((b, d) => (Math.abs(d.departure - departureMs) < Math.abs(b.departure - departureMs) ? d : b), outlook[0])?.worst ?? 0
  const playMs = start + hour * HOUR
  const tripEnd = departureMs + tripDurationS * 1000

  function timeAt(el: HTMLElement, clientX: number) {
    const r = el.getBoundingClientRect()
    return start + Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * span
  }

  function drag(el: HTMLElement | null, e: ReactPointerEvent, move: (ms: number) => void) {
    if (!el) return
    e.preventDefault()
    move(timeAt(el, e.clientX))
    const onMove = (ev: PointerEvent) => move(timeAt(el, ev.clientX))
    const onUp = () => (window.removeEventListener('pointermove', onMove), window.removeEventListener('pointerup', onUp))
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const snap = (ms: number) => steps.reduce((b, s) => (Math.abs(s - ms) < Math.abs(b - ms) ? s : b), steps[0])
  const setLeave = (ms: number) => {
    clock.pause()
    onDepartureChange(snap(ms))
  }
  const setForecast = (ms: number) => {
    clock.pause()
    onMapClockChange('forecast')
    clock.set((ms - start) / HOUR)
  }
  function nudge(dir: number) {
    const i = steps.findIndex((s) => s >= departureMs - 1)
    setLeave(steps[Math.min(steps.length - 1, Math.max(0, i + dir))])
  }
  function play() {
    if (playing) return clock.pause()
    onMapClockChange('forecast')
    // Replay the trip from departure unless the playhead is already inside it.
    if (mapClock !== 'forecast' || playMs < departureMs || playMs >= Math.min(tripEnd, start + span) - HOUR) clock.set((departureMs - start) / HOUR)
    clock.play()
  }

  const ticks: number[] = []
  for (let ms = Math.ceil(start / (12 * HOUR)) * 12 * HOUR; ms <= start + span; ms += 12 * HOUR) ticks.push(ms)
  const stepW = span ? (HOUR / span) * 100 : 0

  return (
    <div className="flex flex-col gap-3 rounded-2xl border bg-popover/95 p-3 shadow-xl backdrop-blur">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={play} size="sm" variant={playing ? 'secondary' : 'default'}>
          {playing ? <PauseIcon data-icon="inline-start" /> : <PlayIcon data-icon="inline-start" />}
          {playing ? 'Pause' : 'Play trip'}
        </Button>
        {mapClock === 'trip' ? (
          <Badge variant="secondary" className="h-6">
            Map: weather when you get there
          </Badge>
        ) : (
          <>
            <Badge className="h-6 tabular-nums">Map: forecast {formatTime(playMs)}</Badge>
            <Button size="sm" variant="ghost" onClick={() => (clock.pause(), onMapClockChange('trip'))}>
              <Undo2Icon data-icon="inline-start" />
              Back to my trip
            </Button>
          </>
        )}
        <div className="flex-1" />
        {best && currentWorst > best.worst && (
          <Button size="sm" variant="outline" onClick={() => setLeave(best.from)} className="border-risk-low/50">
            <CalendarCheckIcon data-icon="inline-start" className="text-risk-low" />
            Best window: {formatTime(best.from)}
            {best.to > best.from && `–${formatTime(best.to)}`}
          </Button>
        )}
        {!compact && <Layers {...{ layer, onLayerChange, showHeatmap, onShowHeatmapChange }} />}
      </div>

      <div className="grid grid-cols-[4.5rem_1fr] items-center gap-x-3 gap-y-2 text-xs">
        <span className="text-muted-foreground">Leave</span>
        <div ref={leaveRef} className="relative h-7 cursor-pointer touch-none" onPointerDown={(e) => drag(leaveRef.current, e, setLeave)}>
          {/* Each departure hour, tinted by the safest route's worst level if you left then. */}
          <div className="absolute inset-y-2 right-0 left-0 overflow-hidden rounded-full bg-muted">
            {outlook.map((d) => (
              <div key={d.departure} className="absolute inset-y-0" style={{ left: pct(d.departure), width: `${stepW}%`, background: riskColor(d.worst), opacity: 0.55 }} />
            ))}
          </div>
          {now > start && <div className="absolute inset-y-1 left-0 rounded-l-full bg-background/60" style={{ width: pct(now) }} aria-hidden />}
          <div
            role="slider"
            tabIndex={0}
            aria-label="Departure time"
            aria-valuemin={steps[0]}
            aria-valuemax={steps[steps.length - 1]}
            aria-valuenow={departureMs}
            aria-valuetext={`Leave ${formatTime(departureMs)}`}
            onKeyDown={(e) => (e.key === 'ArrowLeft' ? nudge(-1) : e.key === 'ArrowRight' ? nudge(1) : null)}
            className="absolute top-1/2 flex -translate-x-1/2 -translate-y-1/2 cursor-ew-resize items-center gap-1 rounded-full border-2 border-background bg-primary px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap text-primary-foreground shadow-md outline-none focus-visible:ring-3 focus-visible:ring-ring/60"
            style={{ left: pct(departureMs) }}
          >
            {formatTime(departureMs)}
          </div>
        </div>

        <span className="text-muted-foreground">Forecast</span>
        <div ref={forecastRef} className="relative h-7 cursor-pointer touch-none" onPointerDown={(e) => drag(forecastRef.current, e, setForecast)}>
          <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-muted" />
          {/* The trip itself, from the Leave pin to arrival on the selected route. */}
          <div className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-primary/50" style={{ left: pct(departureMs), width: `calc(${pct(tripEnd)} - ${pct(departureMs)})` }} />
          <div
            className="absolute inset-y-0 right-0 rounded-r-full bg-[repeating-linear-gradient(45deg,transparent_0_4px,rgba(242,201,76,0.18)_4px_8px)]"
            style={{ left: pct(Date.parse(t.long_range_after)) }}
            title="Long-range forecast"
          />
          <div
            role="slider"
            tabIndex={0}
            aria-label="Forecast time"
            aria-valuemin={0}
            aria-valuemax={48}
            aria-valuenow={Math.round(hour)}
            aria-valuetext={`Forecast ${formatTime(playMs)}`}
            onKeyDown={(e) => (e.key === 'ArrowLeft' ? setForecast(playMs - HOUR) : e.key === 'ArrowRight' ? setForecast(playMs + HOUR) : null)}
            className={cn(
              'absolute top-1/2 size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 shadow outline-none focus-visible:ring-3 focus-visible:ring-ring/60',
              mapClock === 'forecast' ? 'border-primary bg-foreground' : 'border-muted-foreground bg-muted',
            )}
            style={{ left: pct(playMs) }}
          />
        </div>

        <span />
        <div className="relative h-4 text-[11px] text-muted-foreground">
          {now >= start && (
            <span className="absolute -translate-x-1/2 font-semibold text-foreground" style={{ left: pct(now) }}>
              Now
            </span>
          )}
          {ticks.map((ms) => (
            <span key={ms} className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: pct(ms) }}>
              {formatTime(ms)}
            </span>
          ))}
        </div>
      </div>

      {compact && <Layers {...{ layer, onLayerChange, showHeatmap, onShowHeatmapChange }} />}
      <Legend layer={layer} />
    </div>
  )
}

function Layers({ layer, onLayerChange, showHeatmap, onShowHeatmapChange }: Pick<Props, 'layer' | 'onLayerChange' | 'showHeatmap' | 'onShowHeatmapChange'>) {
  return (
    <div className="flex items-center gap-2">
      <Switch checked={showHeatmap} onCheckedChange={onShowHeatmapChange} aria-label="Show weather layer" />
      <ToggleGroup type="single" size="sm" variant="outline" value={layer} onValueChange={(v) => v && onLayerChange(v as Layer)} disabled={!showHeatmap} aria-label="Weather layer">
        {(Object.keys(LAYERS) as Layer[]).map((k) => (
          <ToggleGroupItem key={k} value={k} className="px-2.5 text-xs">
            {LAYERS[k].label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  )
}

function Legend({ layer }: { layer: Layer }) {
  if (layer === 'risk') {
    return (
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {RISK_LEVELS.map((r) => (
          <span key={r.key} className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="size-2.5 rounded-sm" style={{ background: r.color }} />
            {r.label}
          </span>
        ))}
      </div>
    )
  }
  const { stops, unit } = LAYERS[layer]
  const gradient = stops.map(([v, c]) => `${c} ${(v / stops[stops.length - 1][0]) * 100}%`).join(', ')
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      {stops[0][0]}
      <span className="h-2 max-w-72 flex-1 rounded-full border" style={{ background: `linear-gradient(90deg, ${gradient})` }} />
      {stops[stops.length - 1][0]}+ {unit}
    </div>
  )
}

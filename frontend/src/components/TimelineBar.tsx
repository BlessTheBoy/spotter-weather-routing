import { LayersIcon, PauseIcon, PlayIcon, Undo2Icon } from 'lucide-react'
import { useRef, type PointerEvent as ReactPointerEvent } from 'react'
import type { Interval, Plan } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useForecastHour, usePlaying, type Clock } from '@/lib/clock'
import { LAYERS, type Layer } from '@/lib/forecast'
import { formatTime } from '@/lib/format'
import { departureOutlook, saferDeparture } from '@/lib/plan'
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
  /** Apply the suggested safer departure (with Undo). */
  onApplyDeparture: (ms: number) => void
  tripDurationS: number
  /** The tint and the safer-departure suggestion follow this route. */
  routeId: string
  routeLabel: string
  layer: Layer
  onLayerChange: (l: Layer) => void
  showHeatmap: boolean
  onShowHeatmapChange: (on: boolean) => void
  compact?: boolean
  /** Inside another card (the mobile deck): no card chrome of its own, and Layers lives on the map. */
  bare?: boolean
  /** Play was pressed: the mobile deck folds away and the map shows every route. */
  onPlay?: () => void
}

type PlayerProps = Pick<Props, 'plan' | 'clock' | 'mapClock' | 'onMapClockChange' | 'departureMs' | 'tripDurationS' | 'onPlay'>

/** Play and pause the trip on the forecast clock: from departure to arrival, never past it. */
function useTripPlayer({ plan, clock, mapClock, onMapClockChange, departureMs, tripDurationS, onPlay }: PlayerProps) {
  const hour = useForecastHour(clock)
  const playing = usePlaying(clock)
  const start = Date.parse(plan.timeline.start)
  const span = Date.parse(plan.timeline.end) - start
  const playMs = start + hour * HOUR
  const tripEnd = departureMs + tripDurationS * 1000
  function toggle() {
    if (playing) return clock.pause()
    onMapClockChange('forecast')
    // Replay the trip from departure unless the knob is already inside it.
    if (mapClock !== 'forecast' || playMs < departureMs || playMs >= Math.min(tripEnd, start + span) - HOUR) clock.set((departureMs - start) / HOUR)
    // Stop when the truck arrives: the rest of the 48 h isn't part of this trip.
    clock.play((tripEnd - start) / HOUR)
    onPlay?.()
  }
  return { hour, playing, start, span, playMs, tripEnd, toggle }
}

/** The timeline folded into the minimized deck: play/pause, the hour on the map, and how far along the trip it is. */
export function MiniPlayer({ onExpand, ...props }: PlayerProps & { onExpand: () => void }) {
  const { playing, playMs, tripEnd, toggle } = useTripPlayer(props)
  const done = Math.min(1, Math.max(0, (playMs - props.departureMs) / Math.max(1, tripEnd - props.departureMs)))
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <Button size="icon" className="size-9 shrink-0 rounded-full" onClick={toggle} aria-label={playing ? 'Pause' : 'Play the trip'}>
        {playing ? <PauseIcon /> : <PlayIcon />}
      </Button>
      <button type="button" className="flex min-w-0 flex-1 flex-col gap-1 text-left" onClick={onExpand}>
        <span className="truncate text-sm font-semibold">Forecast for {formatTime(playMs)}</span>
        <span className="h-1 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="Trip played" aria-valuenow={Math.round(done * 100)}>
          <span className="block h-full rounded-full bg-primary" style={{ width: `${done * 100}%` }} />
        </span>
      </button>
    </div>
  )
}

/**
 * One 48 h track.
 * - The "Leave" flag above the track is the departure: drag the flag to re-time every route.
 * - The round knob on the track is the forecast clock: drag it (or press Play) to see the map at that hour.
 * - The track is tinted by how safe the selected route would be for each departure hour.
 * - A green ghost flag under the track marks the first safer departure; tap it to leave then.
 */
export function TimelineBar(props: Props) {
  const { plan, interval, clock, mapClock, onMapClockChange, departureMs, onDepartureChange, onApplyDeparture, routeId, routeLabel, compact, bare } = props
  const { hour, playing, start, span, playMs, toggle: play } = useTripPlayer(props)
  const track = useRef<HTMLDivElement>(null)
  const t = plan.timeline
  const pct = (ms: number) => `${Math.min(100, Math.max(0, ((ms - start) / span) * 100))}%`
  const now = Date.parse(t.now)
  const outlook = departureOutlook(plan, interval, routeId)
  const steps = outlook.map((d) => d.departure)
  const safer = saferDeparture(plan, interval, departureMs, routeId)
  const stepW = span ? (HOUR / span) * 100 : 0
  const leaveFrac = span ? (departureMs - start) / span : 0
  const saferFrac = safer && span ? (safer.at - start) / span : 0
  // Hangs inwards near either end, like the Leave flag.
  const hang = (f: number) => (f < 0.08 ? 'translateX(-6px)' : f > 0.92 ? 'translateX(calc(-100% + 6px))' : 'translateX(-50%)')

  function timeAt(clientX: number) {
    const r = track.current!.getBoundingClientRect()
    return start + Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * span
  }
  function drag(e: ReactPointerEvent, move: (ms: number) => void) {
    e.preventDefault()
    e.stopPropagation()
    move(timeAt(e.clientX))
    const onMove = (ev: PointerEvent) => move(timeAt(ev.clientX))
    const onUp = () => (window.removeEventListener('pointermove', onMove), window.removeEventListener('pointerup', onUp))
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }
  const snap = (ms: number) => steps.reduce((b, s) => (Math.abs(s - ms) < Math.abs(b - ms) ? s : b), steps[0])
  const setLeave = (ms: number) => (clock.pause(), onDepartureChange(snap(ms)))
  const setForecast = (ms: number) => (clock.pause(), onMapClockChange('forecast'), clock.set((ms - start) / HOUR))
  function nudgeLeave(dir: number) {
    const i = steps.findIndex((s) => s >= departureMs - 1)
    setLeave(steps[Math.min(steps.length - 1, Math.max(0, i + dir))])
  }

  const tickStep = (compact ? 24 : 12) * HOUR
  const ticks: number[] = []
  const gap = span * (compact ? 0.16 : 0.08)
  const clear = (ms: number) => !safer || Math.abs(ms - safer.at) > gap
  for (let ms = Math.ceil(start / tickStep) * tickStep; ms <= start + span; ms += tickStep) if (Math.abs(ms - now) > gap && clear(ms)) ticks.push(ms)

  return (
    <div className={cn('flex flex-col gap-1', !bare && 'rounded-2xl border bg-popover/95 shadow-xl backdrop-blur', !bare && (compact ? 'px-3 pt-2 pb-1' : 'px-4 pt-3 pb-2'))}>
      <div className="flex items-center gap-2">
        <Button size="icon" className="rounded-full" onClick={play} aria-label={playing ? 'Pause' : 'Play the trip'}>
          {playing ? <PauseIcon /> : <PlayIcon />}
        </Button>
        <p className="min-w-0 flex-1 truncate text-sm font-semibold">{mapClock === 'trip' ? 'Weather when you get there' : `Forecast for ${formatTime(playMs)}`}</p>
        {mapClock === 'forecast' && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="icon" variant="ghost" onClick={() => (clock.pause(), onMapClockChange('trip'))} aria-label="Back to my trip">
                <Undo2Icon />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Back to my trip</TooltipContent>
          </Tooltip>
        )}
        {!bare && <LayersButton {...props} />}
      </div>

      {/* Track: tap or drag anywhere to move the forecast knob. The flag above it is the departure. */}
      <div className="relative mt-6 mb-1 touch-none select-none">
        <div ref={track} className="relative h-6 cursor-pointer" onPointerDown={(e) => drag(e, setForecast)}>
          <div className="absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 overflow-hidden rounded-full bg-muted">
            {/* Tint: how bad the selected route would be if you left at that hour. */}
            {outlook.map((d) => (
              <div
                key={d.departure}
                className="absolute inset-y-0"
                title={`${routeLabel} if you leave ${formatTime(d.departure)}: ${RISK_LEVELS[d.worst].label}`}
                style={{ left: pct(d.departure), width: `${stepW}%`, background: riskColor(d.worst), opacity: 0.75 }}
              />
            ))}
            {now > start && <div className="absolute inset-y-0 left-0 bg-background/70" style={{ width: pct(now) }} />}
          </div>
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
              'absolute top-1/2 size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 shadow-md outline-none focus-visible:ring-3 focus-visible:ring-ring/60',
              mapClock === 'forecast' ? 'border-background bg-foreground' : 'border-muted-foreground/60 bg-muted',
            )}
            style={{ left: pct(playMs) }}
          />
        </div>

        <div
          role="slider"
          tabIndex={0}
          aria-label="Departure time"
          aria-valuemin={steps[0]}
          aria-valuemax={steps[steps.length - 1]}
          aria-valuenow={departureMs}
          aria-valuetext={`Leave ${formatTime(departureMs)}`}
          onPointerDown={(e) => drag(e, setLeave)}
          onKeyDown={(e) => (e.key === 'ArrowLeft' ? nudgeLeave(-1) : e.key === 'ArrowRight' ? nudgeLeave(1) : null)}
          className="absolute -top-6 h-6 w-0 cursor-ew-resize outline-none focus-visible:[&>span]:ring-3 focus-visible:[&>span]:ring-ring/60"
          style={{ left: pct(departureMs) }}
        >
          {/* Near either end the label hangs inwards so it never leaves the bar; the stem stays on the exact time. */}
          <span
            className="absolute top-0 rounded-md bg-primary px-1.5 py-0.5 text-[10px] font-bold whitespace-nowrap text-primary-foreground shadow"
            style={{ transform: leaveFrac < 0.15 ? 'translateX(-6px)' : leaveFrac > 0.85 ? 'translateX(calc(-100% + 6px))' : 'translateX(-50%)' }}
          >
            Leave {formatTime(departureMs)}
          </span>
          <span className="absolute bottom-0 h-2.5 w-0.5 -translate-x-1/2 bg-primary" />
        </div>
      </div>

      <div className="relative h-5 text-[10px] text-muted-foreground">
        {safer && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => onApplyDeparture(safer.at)}
                aria-label={`Leave ${formatTime(safer.at)} instead: no Severe or No Travel`}
                className="absolute -top-1 z-10 rounded-md border border-dashed border-risk-low bg-popover px-1.5 py-px font-bold whitespace-nowrap text-risk-low outline-none before:absolute before:bottom-full before:left-[var(--stem)] before:h-1.5 before:w-px before:bg-risk-low after:absolute after:-inset-2 hover:bg-risk-low/15 focus-visible:ring-3 focus-visible:ring-ring/60"
                style={{ left: pct(safer.at), transform: hang(saferFrac), ['--stem' as string]: saferFrac < 0.08 ? '6px' : saferFrac > 0.92 ? 'calc(100% - 6px)' : '50%' }}
              >
                +{Math.round((safer.at - departureMs) / HOUR)} h ✓
              </button>
            </TooltipTrigger>
            <TooltipContent>Leave {formatTime(safer.at)}: no Severe or No Travel</TooltipContent>
          </Tooltip>
        )}
        {now >= start && clear(now) && (
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
  )
}

type LayerProps = Pick<Props, 'layer' | 'onLayerChange' | 'showHeatmap' | 'onShowHeatmapChange'> & { round?: boolean }

/** Like Google's layers button: the weather layer, its type and the legend live behind one control. */
export function LayersButton({ layer, onLayerChange, showHeatmap, onShowHeatmapChange, round }: LayerProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        {round ? (
          <Button size="icon" variant="outline" className="size-11 rounded-full bg-popover/95 shadow-lg" aria-label={`Weather layer: ${showHeatmap ? LAYERS[layer].label : 'off'}`}>
            <LayersIcon />
          </Button>
        ) : (
          <Button size="sm" variant="outline" aria-label="Weather layer">
            <LayersIcon data-icon="inline-start" />
            {showHeatmap ? LAYERS[layer].label : 'Off'}
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" side={round ? 'left' : undefined} className="flex w-72 max-w-[calc(100vw-5rem)] flex-col gap-3">
        <div className="flex items-center justify-between">
          <Label htmlFor="heat">Weather on the map</Label>
          <Switch id="heat" checked={showHeatmap} onCheckedChange={onShowHeatmapChange} />
        </div>
        {/* Picking a layer also turns it on. */}
        <ToggleGroup type="single" variant="outline" size="sm" value={showHeatmap ? layer : ''} onValueChange={(v) => v && (onLayerChange(v as Layer), onShowHeatmapChange(true))} className="w-full">
          {(Object.keys(LAYERS) as Layer[]).map((k) => (
            <ToggleGroupItem key={k} value={k} className="flex-1 text-xs">
              {LAYERS[k].label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <Separator />
        <Legend layer={layer} />
      </PopoverContent>
    </Popover>
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
      <span className="h-2 flex-1 rounded-full border" style={{ background: `linear-gradient(90deg, ${gradient})` }} />
      {stops[stops.length - 1][0]}+ {unit}
    </div>
  )
}

import { ArrowUpIcon, ArrowUpLeftIcon, ArrowUpRightIcon, CheckCircle2Icon, CornerUpLeftIcon, CornerUpRightIcon, FlagIcon, PauseIcon, PlayIcon, TriangleAlertIcon } from 'lucide-react'
import type { Instruction, Route } from '@/api/types'
import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { formatDuration, formatTime } from '@/lib/format'
import { SPEEDS, type NavState } from '@/lib/navigation'
import type { CheckpointState } from '@/lib/plan'
import { riskColor, riskLabel } from '@/lib/risk'
import { navPadding } from '@/map/MapView'

const ICON: Record<Instruction['maneuver'], typeof ArrowUpIcon> = {
  depart: ArrowUpIcon,
  straight: ArrowUpIcon,
  left: CornerUpLeftIcon,
  right: CornerUpRightIcon,
  slight_left: ArrowUpLeftIcon,
  slight_right: ArrowUpRightIcon,
  arrive: FlagIcon,
}

function distance(mi: number): string {
  if (mi < 0.2) return `${Math.round((mi * 5280) / 50) * 50} ft`
  return `${mi < 10 ? mi.toFixed(1) : Math.round(mi)} mi`
}

interface Props {
  route: Route
  nav: NavState
  states: CheckpointState[]
  departureMs: number
  onSpeedChange: (s: number) => void
  onTogglePlaying: () => void
  onEnd: () => void
}

export function NavigateOverlay({ route, nav, states, departureMs, onSpeedChange, onTogglePlaying, onEnd }: Props) {
  const ahead = route.instructions.filter((s) => s.mile > nav.mile + 0.01)
  const next = ahead[0] ?? route.instructions[route.instructions.length - 1]
  const then = ahead[1]
  const Icon = ICON[next.maneuver]
  const road = [...route.instructions].reverse().find((s) => s.mile <= nav.mile && s.road)?.road
  const hazard = states.find((s) => s.mile > nav.mile && (s.level ?? 0) >= 2)
  const remainingS = Math.max(0, route.duration_s - nav.elapsedS)
  const clockMs = nav.source === 'gps' ? Date.now() : departureMs + nav.elapsedS * 1000
  const elements = hazard
    ? (['wind', 'rain', 'snow'] as const).filter((k) => (k === 'wind' ? Math.max(hazard.windLevel, hazard.loadLevel) : k === 'rain' ? hazard.rainLevel : hazard.snowLevel) === hazard.level)
    : []
  const { top, bottom } = navPadding(window.innerHeight)

  return (
    <>
      {/* The puck stays put in the lower third and points up; the map turns under it. */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 z-10 grid size-12 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-primary/20"
        style={{ top: `calc(${top}px + (100% - ${top + bottom}px) / 2)` }}
      >
        <svg width="32" height="32" viewBox="0 0 24 24">
          <path d="M12 2 4.5 20.29l.71.71L12 18l6.79 3 .71-.71z" fill="#40E0D0" stroke="#043344" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
      </div>

      <div className="absolute top-3 right-3 left-3 z-20 flex flex-col gap-2 md:right-auto md:w-96">
        <div className="flex items-center gap-3 rounded-2xl bg-[#0F6E56] px-4 py-3 text-white shadow-2xl">
          <Icon className="size-10 shrink-0" strokeWidth={2.5} />
          <div className="min-w-0">
            <p className="text-3xl leading-none font-bold">{nav.arrived ? 'Arrived' : distance(next.mile - nav.mile)}</p>
            <p className="truncate text-base font-medium">{nav.arrived ? route.label : next.text}</p>
          </div>
        </div>
        {then && !nav.arrived && (
          <p className="w-fit rounded-xl bg-[#085041] px-3 py-1 text-sm text-[#E1F5EE] shadow">
            Then {then.text.toLowerCase()} in {distance(then.mile - next.mile)}
          </p>
        )}
        {!nav.arrived &&
          (hazard ? (
            <div className="flex w-fit items-center gap-2 rounded-xl border-2 bg-popover/95 px-3 py-2 shadow" style={{ borderColor: riskColor(hazard.level) }}>
              <TriangleAlertIcon className="size-5" style={{ color: riskColor(hazard.level) }} />
              <span className="text-sm font-semibold">
                {riskLabel(hazard.level)} {elements.join(' and ')} in {distance(hazard.mile - nav.mile)} · {formatTime(hazard.eta)}
              </span>
            </div>
          ) : (
            <div className="flex w-fit items-center gap-2 rounded-xl bg-popover/95 px-3 py-2 text-sm shadow">
              <CheckCircle2Icon className="size-5 text-risk-low" />
              Clear weather to your destination
            </div>
          ))}
      </div>

      <div className="absolute right-3 bottom-6 left-3 z-20 mx-auto flex max-w-3xl flex-col gap-2">
        {road && <p className="mx-auto w-fit rounded-full bg-popover/95 px-3 py-1 text-sm font-semibold shadow">{road}</p>}
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border bg-popover/95 px-4 py-3 shadow-2xl backdrop-blur">
          <div>
            <p className="text-2xl leading-tight font-bold text-primary">{formatDuration(remainingS)}</p>
            <p className="text-sm text-muted-foreground">
              {distance(Math.max(0, route.distance_mi - nav.mile))} · ETA {formatTime(clockMs + remainingS * 1000)}
            </p>
          </div>
          <div className="flex-1" />
          {nav.source === 'simulated' && (
            <div className="flex items-center gap-2">
              <span className="rounded-md bg-risk-moderate/15 px-2 py-1 text-xs font-bold tracking-wide text-risk-moderate" title={nav.reason ?? undefined}>
                SIMULATED
              </span>
              <Button size="icon" variant="secondary" className="size-11" onClick={onTogglePlaying} aria-label={nav.playing ? 'Pause drive' : 'Resume drive'}>
                {nav.playing ? <PauseIcon /> : <PlayIcon />}
              </Button>
              <ToggleGroup type="single" variant="outline" value={String(nav.speed)} onValueChange={(v) => v && onSpeedChange(Number(v))} aria-label="Simulation speed">
                {SPEEDS.map((s) => (
                  <ToggleGroupItem key={s} value={String(s)} className="h-11 min-w-11 px-2">
                    {s}×
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
          )}
          <Button variant="destructive" className="h-11 px-6" onClick={onEnd}>
            End
          </Button>
        </div>
      </div>
    </>
  )
}

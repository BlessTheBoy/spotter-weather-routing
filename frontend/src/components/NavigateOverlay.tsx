import { ArrowUpIcon, ArrowUpLeftIcon, ArrowUpRightIcon, CheckCircle2Icon, CornerUpLeftIcon, CornerUpRightIcon, FlagIcon, MapPinOffIcon, PauseIcon, PlayIcon, TriangleAlertIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { Instruction, Route } from '@/api/types'
import { Button } from '@/components/ui/button'
import { formatDuration, formatTime } from '@/lib/format'
import { INTRO_MS, SPEEDS, type NavState } from '@/lib/navigation'
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

/** Road names the way drivers say them: "Interstate Highway 77 N/I-77 N" → "I-77 N". */
export function shortRoad(text: string): string {
  return text
    .replace(/Interstate Highway (\d+)( [NSEW])?\/I-\d+( [NSEW])?/gi, 'I-$1$2')
    .replace(/Interstate Highway /gi, 'I-')
    .replace(/United States Highway /gi, 'US-')
    .replace(/US Highway /gi, 'US-')
    .replace(/State Highway /gi, 'SR-')
    .replace(/\s+/g, ' ')
    // One road can carry several shields ("US-21 N/I-77 N/US-21 N"): list each once, Interstate first.
    .replace(/[A-Z]{1,3}-\d+[A-Z]?(?: [NSEW])?(?:\/[A-Z]{1,3}-\d+[A-Z]?(?: [NSEW])?)+/g, (run) =>
      [...new Set(run.split('/'))].sort((a, b) => Number(!a.startsWith('I-')) - Number(!b.startsWith('I-'))).join(' / '),
    )
    .trim()
}

/** The "then" hint: one short clause, sentence case, without TomTom's "toward …" tail. */
function thenText(i: Instruction): string {
  const t = shortRoad(i.text).replace(/ toward .*$/i, '')
  return t.charAt(0).toLowerCase() + t.slice(1)
}

interface Props {
  route: Route
  nav: NavState
  states: CheckpointState[]
  departureMs: number
  onSpeedChange: (s: number) => void
  onTogglePlaying: () => void
  onSimulateInstead: () => void
  onEnd: () => void
}

export function NavigateOverlay({ route, nav, states, departureMs, onSpeedChange, onTogglePlaying, onSimulateInstead, onEnd }: Props) {
  const ahead = route.instructions.filter((s) => s.mile > nav.mile + 0.01)
  const next = ahead[0] ?? route.instructions[route.instructions.length - 1]
  const then = ahead[1]
  const Icon = ICON[next.maneuver]
  const road = [...route.instructions].reverse().find((s) => s.mile <= nav.mile && s.road)?.road
  // The stretch you're in now, and the worst weather still ahead.
  const current = states.find((s, i) => nav.mile < (states[i + 1] ? (s.mile + states[i + 1].mile) / 2 : Infinity))
  const inHazard = current && (current.level ?? 0) >= 2 ? current : null
  const worstAhead = states.filter((s) => s.mile > nav.mile && (s.level ?? 0) >= 2).sort((a, b) => (b.level ?? 0) - (a.level ?? 0) || a.mile - b.mile)[0]
  const remainingS = Math.max(0, route.duration_s - nav.elapsedS)
  const clockMs = nav.source === 'gps' ? Date.now() : departureMs + nav.elapsedS * 1000
  const elementsOf = (h: CheckpointState) =>
    (['wind', 'rain', 'snow'] as const).filter((k) => (k === 'wind' ? Math.max(h.windLevel, h.loadLevel) : k === 'rain' ? h.rainLevel : h.snowLevel) === h.level).join(' and ')
  const { top, bottom } = navPadding(window.innerHeight)
  const offRoute = nav.offRouteMi != null
  const sim = nav.source === 'simulated'
  // The puck appears once the camera has flown in and sits on the truck.
  const [landed, setLanded] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setLanded(true), INTRO_MS)
    return () => clearTimeout(t)
  }, [])

  return (
    <>
      {/* The puck stays put in the lower third and points up; the map turns under it. */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 z-10 grid size-12 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-primary/20 transition-opacity duration-300"
        style={{ top: `calc(${top}px + (100% - ${top + bottom}px) / 2)`, opacity: landed ? 1 : 0 }}
      >
        <svg width="32" height="32" viewBox="0 0 24 24">
          <path d="M12 2 4.5 20.29l.71.71L12 18l6.79 3 .71-.71z" fill="#40E0D0" stroke="#043344" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
      </div>

      <div className="absolute top-3 right-3 left-3 z-20 flex flex-col gap-2 md:right-auto md:w-[26rem]">
        {offRoute ? (
          <div className="flex items-start gap-3 rounded-2xl bg-popover/95 px-4 py-3 shadow-2xl">
            <MapPinOffIcon className="mt-0.5 size-7 shrink-0 text-risk-moderate" />
            <div className="min-w-0 flex-1">
              <p className="text-lg leading-tight font-bold">{Math.round(nav.offRouteMi!).toLocaleString()} mi from the start</p>
              <p className="text-sm text-muted-foreground">Head to the start of {route.label}. Your position and heading are live.</p>
              <Button size="sm" variant="secondary" className="mt-2" onClick={onSimulateInstead}>
                Simulate the drive instead
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3 rounded-2xl bg-[#0F6E56] px-4 py-3 text-white shadow-2xl">
              <Icon className="size-9 shrink-0" strokeWidth={2.5} />
              <div className="min-w-0">
                <p className="text-2xl leading-none font-bold">{nav.arrived ? 'Arrived' : distance(next.mile - nav.mile)}</p>
                <p className="line-clamp-2 text-base leading-snug font-medium">{nav.arrived ? route.label : shortRoad(next.text)}</p>
              </div>
            </div>
            {then && !nav.arrived && (
              <p className="w-fit max-w-full truncate rounded-xl bg-[#085041] px-3 py-1 text-sm text-[#E1F5EE] shadow">
                Then {thenText(then)} in {distance(then.mile - next.mile)}
              </p>
            )}
          </>
        )}
        {!nav.arrived &&
          !offRoute &&
          (inHazard ? (
            <Hazard color={riskColor(inHazard.level)} text={`${riskLabel(inHazard.level)} ${elementsOf(inHazard)} now`} />
          ) : worstAhead ? (
            <Hazard color={riskColor(worstAhead.level)} text={`${riskLabel(worstAhead.level)} ${elementsOf(worstAhead)} in ${distance(worstAhead.mile - nav.mile)} · ${formatTime(worstAhead.eta)}`} />
          ) : (
            <div className="flex w-fit items-center gap-2 rounded-xl bg-popover/95 px-3 py-2 text-sm shadow">
              <CheckCircle2Icon className="size-5 text-risk-low" />
              Clear weather to your destination
            </div>
          ))}
      </div>

      <div className="absolute right-3 bottom-4 left-3 z-20 mx-auto flex max-w-xl flex-col gap-2">
        {road && !offRoute && <p className="mx-auto w-fit rounded-full bg-popover/95 px-3 py-1 text-sm font-semibold shadow">{shortRoad(road)}</p>}
        <div className="flex flex-col gap-2 rounded-2xl border bg-popover/95 px-4 py-3 shadow-2xl backdrop-blur">
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-2xl leading-tight font-bold text-primary">{formatDuration(remainingS)}</p>
              <p className="truncate text-sm text-muted-foreground">
                {sim && (
                  <span className="font-semibold text-risk-moderate" title={nav.reason ?? 'Simulated drive'}>
                    Sim ·{' '}
                  </span>
                )}
                ETA {formatTime(clockMs + remainingS * 1000)} · {distance(Math.max(0, route.distance_mi - nav.mile))}
              </p>
            </div>
            {sim && (
              <>
                <Button size="icon" variant="secondary" className="size-11 shrink-0" onClick={onTogglePlaying} aria-label={nav.playing ? 'Pause drive' : 'Resume drive'}>
                  {nav.playing ? <PauseIcon /> : <PlayIcon />}
                </Button>
                {/* One button steps through the speeds. */}
                <Button
                  variant="secondary"
                  className="h-11 min-w-14 shrink-0 tabular-nums"
                  onClick={() => onSpeedChange(SPEEDS[(SPEEDS.indexOf(nav.speed as (typeof SPEEDS)[number]) + 1) % SPEEDS.length])}
                  aria-label={`Simulation speed ${nav.speed}×, change`}
                >
                  {nav.speed}×
                </Button>
              </>
            )}
            <Button variant="destructive" className="h-11 px-5" onClick={onEnd}>
              End
            </Button>
          </div>
        </div>
      </div>
    </>
  )
}

function Hazard({ color, text }: { color: string; text: string }) {
  return (
    <div className="flex w-fit max-w-full items-center gap-2 rounded-xl border-2 bg-popover/95 px-3 py-2 shadow" style={{ borderColor: color }}>
      <TriangleAlertIcon className="size-5 shrink-0" style={{ color }} />
      <span className="truncate text-sm font-semibold">{text}</span>
    </div>
  )
}

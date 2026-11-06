import { ArrowLeftIcon, ChevronDownIcon, NavigationIcon, PlayCircleIcon, StarIcon, TriangleAlertIcon } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { Criterion, Interval, Plan, Route, RouteSummary } from '@/api/types'
import { RiskStrip } from '@/components/RiskStrip'
import { StartDialog } from '@/components/StartDialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatDuration, formatMiles, formatTime } from '@/lib/format'
import { isNow, optionAt, type CheckpointState } from '@/lib/plan'
import { CRITERIA_LABELS, RISK_LEVELS, riskColor, riskLabel } from '@/lib/risk'
import { cn } from '@/lib/utils'

/** What every Compare surface (desktop panel, mobile deck and sheet) needs from the plan. */
export interface CompareProps {
  plan: Plan
  /** Chosen in Plan; fixed here so the numbers can't shift while comparing. */
  interval: Interval
  departureMs: number
  /** Apply a suggested departure (with an Undo). */
  onApplyDeparture: (ms: number) => void
  selectedRouteId: string
  onSelectRoute: (id: string) => void
  /** Checkpoint states of the selected route under the current clock. */
  states: CheckpointState[]
  hoveredCheckpoint: number | null
  onHoverCheckpoint: (i: number | null) => void
  onEdit: () => void
  onStart: (mode: 'live' | 'preview') => void
}

export const shortPlace = (label: string) => label.replace(/^Your location · /, '').split(',')[0]
export const routeName = (r: Route) => (r.via ? `${r.label} · via ${r.via}` : r.label)

export function useCompare({ plan, interval, departureMs, selectedRouteId }: Pick<CompareProps, 'plan' | 'interval' | 'departureMs' | 'selectedRouteId'>) {
  const option = optionAt(plan, interval, departureMs)
  const rec = option.recommendation
  // The recommended route always leads; the rest follow in ranking order.
  const routes = useMemo(() => rec.ranking.map((id) => plan.routes.find((r) => r.id === id)!), [plan.routes, rec.ranking])
  const route = plan.routes.find((r) => r.id === selectedRouteId)!
  const summary = option.summaries[route.id]
  return {
    option,
    rec,
    routes,
    route,
    summary,
    isPick: route.id === rec.route_id,
  }
}

/** Plain-language comparison of the viewed route against the pick. */
function versusPick(view: Route, viewS: RouteSummary, pick: Route, pickS: RouteSummary): string {
  const m = viewS.miles_by_level
  const p = pickS.miles_by_level
  if (m.no_travel !== p.no_travel) return `${formatMiles(m.no_travel)} No Travel, against ${formatMiles(p.no_travel)} on ${pick.label}.`
  if (m.severe !== p.severe) return `${formatMiles(m.severe)} Severe, against ${formatMiles(p.severe)} on ${pick.label}.`
  if (m.high !== p.high) return `${formatMiles(m.high)} High, against ${formatMiles(p.high)} on ${pick.label}.`
  if (viewS.average_risk !== pickS.average_risk) return `Average risk ${viewS.average_risk.toFixed(2)}, against ${pickS.average_risk.toFixed(2)} on ${pick.label}.`
  return `Same risk as ${pick.label}, ${formatDuration(view.duration_s - pick.duration_s)} slower.`
}

/** Back to Plan, with the trip in one line. */
export function TripTitle({ plan, departureMs, onEdit }: Pick<CompareProps, 'plan' | 'departureMs' | 'onEdit'>) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1.5">
      <Button variant="ghost" size="icon" onClick={onEdit} aria-label="Edit trip" className="-ml-2 shrink-0">
        <ArrowLeftIcon />
      </Button>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">
          {shortPlace(plan.origin.label)} → {shortPlace(plan.destination.label)}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {plan.stops.length ? `${plan.stops.length} stop${plan.stops.length > 1 ? 's' : ''} · ` : ''}
          {plan.load_lb.toLocaleString()} lb · leave {formatTime(departureMs)}
        </p>
      </div>
    </div>
  )
}

/** The routes side by side as small chips: worst risk, drive time, and a star on the pick. */
export function RouteChips(props: Pick<CompareProps, 'plan' | 'interval' | 'departureMs' | 'selectedRouteId' | 'onSelectRoute'>) {
  const { option, rec, routes } = useCompare(props)
  return (
    <div
      className="grid gap-1.5"
      style={{
        gridTemplateColumns: `repeat(${routes.length}, minmax(0, 1fr))`,
      }}
      role="radiogroup"
      aria-label="Route options"
    >
      {routes.map((r) => {
        const s = option.summaries[r.id]
        const selected = r.id === props.selectedRouteId
        const isPick = r.id === rec.route_id
        return (
          <button
            key={r.id}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={`${routeName(r)}, ${formatDuration(r.duration_s)}, worst ${riskLabel(s.max_level)}${isPick ? ', recommended' : ''}`}
            onClick={() => props.onSelectRoute(r.id)}
            className={cn(
              'flex min-h-11 min-w-0 flex-col items-start gap-0.5 rounded-lg border px-2 py-1.5 text-left transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
              selected ? 'border-primary bg-primary/10' : 'bg-card hover:border-foreground/25',
            )}
          >
            <span className="flex w-full items-center gap-1 text-xs font-semibold">
              <span className="truncate">{r.label}</span>
              {isPick && <StarIcon className="size-3 shrink-0 fill-primary text-primary" aria-hidden />}
            </span>
            <span className="text-sm leading-tight font-bold tabular-nums">{formatDuration(r.duration_s)}</span>
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <span className="size-2 shrink-0 rounded-full" style={{ background: riskColor(s.max_level) }} aria-hidden />
              {riskLabel(s.max_level)}
            </span>
          </button>
        )
      })}
    </div>
  )
}

/** The worst miles on a route in a few words: "50 mi Severe · 40 mi High", or that it's clear. */
export function badMiles(s: RouteSummary): string {
  const parts = RISK_LEVELS.slice(2)
    .filter((l) => s.miles_by_level[l.key] > 0)
    .reverse()
    .map((l) => `${formatMiles(s.miles_by_level[l.key])} ${l.label}`)
  return parts.length ? parts.join(' · ') : s.max_level === 1 ? 'Moderate at worst' : 'Low risk the whole way'
}

/** One line about the selected route, for the mobile deck. */
export function RouteSummaryLine(props: Pick<CompareProps, 'plan' | 'interval' | 'departureMs' | 'selectedRouteId'>) {
  const { route, summary, isPick } = useCompare(props)
  return (
    <p className="text-xs leading-snug">
      {isPick && <span className="font-semibold text-primary">Recommended · </span>}
      <span
        style={{
          color: summary.max_level >= 2 ? riskColor(summary.max_level) : undefined,
        }}
        className={cn(summary.max_level >= 2 && 'font-semibold')}
      >
        {badMiles(summary)}
      </span>
      <span className="text-muted-foreground"> · arrive {formatTime(props.departureMs + route.duration_s * 1000)}</span>
    </p>
  )
}

/** Why this route, its risk along the way, and how the routes rank. */
export function RouteDetails(props: CompareProps & { rankOpen?: boolean }) {
  const { plan, interval, departureMs, states, hoveredCheckpoint, onHoverCheckpoint } = props
  const { option, rec, routes, route: r, summary: s, isPick } = useCompare(props)
  const [rankOpen, setRankOpen] = useState(props.rankOpen ?? false)
  const fastest = routes.reduce((a, b) => (b.duration_s < a.duration_s ? b : a))
  const pick = plan.routes.find((x) => x.id === rec.route_id)!
  const extra = r.duration_s - fastest.duration_s
  const longRange = departureMs > Date.parse(plan.timeline.long_range_after)

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm">
        {isPick ? (
          <>
            <span className="font-semibold text-primary">Recommended. </span>
            {rec.reason}
            {extra > 60 &&
              ` Costs +${formatDuration(extra)}${r.distance_mi > fastest.distance_mi ? ` and +${formatMiles(r.distance_mi - fastest.distance_mi)}` : ''} against ${fastest.label}.`}
          </>
        ) : (
          <span className="text-muted-foreground">{versusPick(r, s, pick, option.summaries[pick.id])}</span>
        )}
      </p>
      <RiskStrip route={r} states={states} hoveredIndex={hoveredCheckpoint} onHover={onHoverCheckpoint} showTicks />
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
        <span className="text-muted-foreground">
          {formatMiles(r.distance_mi)} · arrive {formatTime(departureMs + r.duration_s * 1000)}
        </span>
        {RISK_LEVELS.slice(1)
          .filter((l) => s.miles_by_level[l.key] > 0)
          .reverse()
          .map((l) => (
            <span key={l.key} className="font-semibold" style={{ color: l.color }}>
              {formatMiles(s.miles_by_level[l.key])} {l.label}
            </span>
          ))}
        <span className="text-muted-foreground">checkpoints every {interval} mi</span>
      </div>

      {longRange && (
        <Alert>
          <TriangleAlertIcon />
          <AlertDescription>Long-range forecast. Check again closer to departure.</AlertDescription>
        </Alert>
      )}

      <Collapsible open={rankOpen} onOpenChange={setRankOpen} className="rounded-xl border">
        <CollapsibleTrigger className="flex w-full items-center justify-between px-3 py-2.5 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
          How the routes rank
          <ChevronDownIcon className={cn('size-4 transition-transform', rankOpen && 'rotate-180')} />
        </CollapsibleTrigger>
        <CollapsibleContent className="px-3 pb-3">
          <Ranking routes={routes} summaries={option.summaries} deciding={rec.deciding_criterion} />
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}

/** Start now (live) or Preview drive (later departure), naming the worst weather ahead. */
export function StartButton(props: CompareProps & { className?: string; hint?: boolean }) {
  const { plan, interval, departureMs, onApplyDeparture, onSelectRoute, onStart } = props
  const { route, summary } = useCompare(props)
  const [confirm, setConfirm] = useState(false)
  const live = isNow(departureMs)
  const severe = summary.miles_by_level.severe
  const noTravel = summary.miles_by_level.no_travel
  const hazard = noTravel > 0 ? `${formatMiles(noTravel)} No Travel ahead` : severe > 0 ? `${formatMiles(severe)} Severe ahead` : null

  function start() {
    // Severe and No Travel ask first, with the safer options; anything milder starts straight away.
    if (severe + noTravel > 0) return setConfirm(true)
    onStart(live ? 'live' : 'preview')
  }

  return (
    <>
      <Button
        size="lg"
        className={cn('h-11 w-full', hazard && live && 'bg-risk-high text-black hover:bg-risk-high/90', props.className)}
        onClick={start}
        variant={live ? 'default' : 'secondary'}
      >
        {live ? <NavigationIcon data-icon="inline-start" /> : <PlayCircleIcon data-icon="inline-start" />}
        <span className="truncate">
          {live ? 'Start now' : 'Preview drive'}
          {hazard && ` · ${hazard}`}
        </span>
      </Button>
      {props.hint && !live && <p className="mt-1.5 text-center text-xs text-muted-foreground">Leaving {formatTime(departureMs)}. Move the Leave flag to now for live guidance.</p>}
      <StartDialog
        open={confirm}
        onOpenChange={setConfirm}
        plan={plan}
        interval={interval}
        route={route}
        departureMs={departureMs}
        onSwitchRoute={(id) => (onSelectRoute(id), setConfirm(false))}
        onLeaveLater={(ms) => (onApplyDeparture(ms), setConfirm(false))}
        onStartAnyway={() => (setConfirm(false), onStart(live ? 'live' : 'preview'))}
      />
    </>
  )
}

/** Desktop side panel: the trip, the route chips, the selected route in full, and Start. */
export function ComparePanel(props: CompareProps) {
  return (
    <div className="flex min-h-full flex-col gap-4">
      <TripTitle {...props} />
      <RouteChips {...props} />
      <RouteDetails {...props} />
      <div className="flex-1" />
      <div className="sticky bottom-0 -mx-1 bg-background/95 px-1 pt-2 pb-1 backdrop-blur">
        <StartButton {...props} hint />
      </div>
    </div>
  )
}

function Ranking({ routes, summaries, deciding }: { routes: Route[]; summaries: Record<string, RouteSummary>; deciding: Criterion | null }) {
  const rows: {
    key: Criterion
    value: (r: Route) => number
    show: (r: Route) => string
  }[] = [
    {
      key: 'no_travel_miles',
      value: (r) => summaries[r.id].miles_by_level.no_travel,
      show: (r) => formatMiles(summaries[r.id].miles_by_level.no_travel),
    },
    {
      key: 'severe_miles',
      value: (r) => summaries[r.id].miles_by_level.severe,
      show: (r) => formatMiles(summaries[r.id].miles_by_level.severe),
    },
    {
      key: 'high_miles',
      value: (r) => summaries[r.id].miles_by_level.high,
      show: (r) => formatMiles(summaries[r.id].miles_by_level.high),
    },
    {
      key: 'average_risk',
      value: (r) => summaries[r.id].average_risk,
      show: (r) => summaries[r.id].average_risk.toFixed(2),
    },
    {
      key: 'travel_time',
      value: (r) => r.duration_s,
      show: (r) => formatDuration(r.duration_s),
    },
  ]
  return (
    <>
      <Table className="table-fixed text-xs">
        <TableHeader>
          <TableRow>
            <TableHead className="h-8 w-[38%]">In order</TableHead>
            {routes.map((r) => (
              <TableHead key={r.id} className="h-8 text-right">
                {r.id}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, i) => {
            const best = Math.min(...routes.map(row.value))
            const isDeciding = row.key === deciding
            return (
              <TableRow key={row.key} className={cn(isDeciding && 'bg-primary/10')}>
                <TableCell className={cn('py-1.5 whitespace-normal', isDeciding ? 'font-semibold text-primary' : 'text-muted-foreground')}>
                  {i + 1}. {CRITERIA_LABELS[row.key]}
                  {isDeciding && ' · decides'}
                </TableCell>
                {routes.map((r) => (
                  <TableCell key={r.id} className={cn('py-1.5 text-right whitespace-normal tabular-nums', row.value(r) === best ? 'font-semibold' : 'text-muted-foreground')}>
                    {row.show(r)}
                  </TableCell>
                ))}
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
      <p className="mt-2 text-xs text-muted-foreground">
        Each checkpoint covers half the gap to its neighbours. Average risk is mile-weighted: Low 0 … No Travel 4. No Travel miles rank first.
      </p>
    </>
  )
}

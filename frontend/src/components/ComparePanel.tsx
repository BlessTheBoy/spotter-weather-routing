import { ArrowLeftIcon, ChevronDownIcon, NavigationIcon, PlayCircleIcon, StarIcon, TriangleAlertIcon, ZapIcon } from 'lucide-react'
import { useMemo, useState } from 'react'
import { INTERVALS, type Criterion, type Interval, type Plan, type Route, type RouteSummary } from '@/api/types'
import { RiskStrip } from '@/components/RiskStrip'
import { StartDialog } from '@/components/StartDialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { formatDuration, formatMiles, formatTime } from '@/lib/format'
import { isNow, optionAt, type CheckpointState } from '@/lib/plan'
import { CRITERIA_LABELS, RISK_LEVELS, riskColor, riskLabel } from '@/lib/risk'
import { cn } from '@/lib/utils'

interface Props {
  plan: Plan
  interval: Interval
  onIntervalChange: (i: Interval) => void
  departureMs: number
  onDepartureChange: (ms: number) => void
  selectedRouteId: string
  onSelectRoute: (id: string) => void
  /** Checkpoint states of the selected route under the current clock. */
  states: CheckpointState[]
  hoveredCheckpoint: number | null
  onHoverCheckpoint: (i: number | null) => void
  onEdit: () => void
  onStart: (mode: 'live' | 'preview') => void
}

const shortPlace = (label: string) => label.replace(/^Your location · /, '').split(',')[0]
export const routeName = (r: Route) => (r.via ? `${r.label} · via ${r.via}` : r.label)

/** Plain-language comparison of the viewed route against the pick, for the selected row. */
function versusPick(view: Route, viewS: RouteSummary, pick: Route, pickS: RouteSummary): string {
  const m = viewS.miles_by_level
  const p = pickS.miles_by_level
  if (m.no_travel !== p.no_travel) return `${formatMiles(m.no_travel)} No Travel, against ${formatMiles(p.no_travel)} on ${pick.label}.`
  if (m.severe !== p.severe) return `${formatMiles(m.severe)} Severe, against ${formatMiles(p.severe)} on ${pick.label}.`
  if (m.high !== p.high) return `${formatMiles(m.high)} High, against ${formatMiles(p.high)} on ${pick.label}.`
  if (viewS.average_risk !== pickS.average_risk) return `Average risk ${viewS.average_risk.toFixed(2)}, against ${pickS.average_risk.toFixed(2)} on ${pick.label}.`
  return `Same risk as ${pick.label}, ${formatDuration(view.duration_s - pick.duration_s)} slower.`
}

export function ComparePanel(props: Props) {
  const { plan, interval, onIntervalChange, departureMs, onDepartureChange, selectedRouteId, onSelectRoute, states, hoveredCheckpoint, onHoverCheckpoint, onEdit, onStart } = props
  const [rankOpen, setRankOpen] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const option = optionAt(plan, interval, departureMs)
  const rec = option.recommendation
  const routes = useMemo(() => [...plan.routes].sort((a, b) => a.id.localeCompare(b.id)), [plan.routes])
  const fastest = routes.reduce((a, b) => (b.duration_s < a.duration_s ? b : a))
  const pick = plan.routes.find((r) => r.id === rec.route_id)!
  const route = plan.routes.find((r) => r.id === selectedRouteId)!
  const summary = option.summaries[route.id]
  const live = isNow(departureMs)
  const longRange = departureMs > Date.parse(plan.timeline.long_range_after)

  function start() {
    if (summary.miles_by_level.no_travel > 0) return setConfirm(true)
    onStart(live ? 'live' : 'preview')
  }

  return (
    <div className="flex min-h-full flex-col gap-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={onEdit} aria-label="Edit trip" className="-ml-2">
          <ArrowLeftIcon />
        </Button>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">
            {shortPlace(plan.origin.label)} → {shortPlace(plan.destination.label)}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {plan.stops.length ? `${plan.stops.length} stop${plan.stops.length > 1 ? 's' : ''} · ` : ''}
            {plan.load_lb.toLocaleString()} lb · leave {formatTime(departureMs)}
          </p>
        </div>
        <ToggleGroup type="single" size="sm" variant="outline" value={String(interval)} onValueChange={(v) => v && onIntervalChange(Number(v) as Interval)} aria-label="Checkpoint every">
          {INTERVALS.map((v) => (
            <ToggleGroupItem key={v} value={String(v)} className="px-2 text-xs" aria-label={`Every ${v} miles`}>
              {v} mi
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      <div className="flex flex-col gap-2" role="radiogroup" aria-label="Route options">
        {routes.map((r) => {
          const s = option.summaries[r.id]
          const selected = r.id === selectedRouteId
          const extra = r.duration_s - fastest.duration_s
          return (
            <div
              key={r.id}
              className={cn('rounded-xl border bg-card transition-colors', selected ? 'border-primary bg-primary/5' : 'hover:border-foreground/20')}
            >
              <button
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => onSelectRoute(r.id)}
                className="grid w-full grid-cols-[auto_1fr_auto] items-center gap-x-3 rounded-xl px-3 py-2.5 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <span className="size-2.5 rounded-full" style={{ background: riskColor(s.max_level) }} aria-hidden />
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-semibold">{routeName(r)}</span>
                    {r.id === rec.route_id && <StarIcon className="size-3.5 shrink-0 fill-primary text-primary" aria-label="Recommended" />}
                    {r.id === fastest.id && (
                      <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">
                        <ZapIcon data-icon="inline-start" />
                        Fastest
                      </Badge>
                    )}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {formatMiles(r.distance_mi)} · worst {riskLabel(s.max_level)}
                    {extra > 60 && ` · +${formatDuration(extra)} vs fastest`}
                  </span>
                </span>
                <span className="text-sm font-semibold tabular-nums" style={{ color: s.max_level >= 3 ? riskColor(s.max_level) : undefined }}>
                  {formatDuration(r.duration_s)}
                </span>
              </button>

              {selected && (
                <div className="flex flex-col gap-2 px-3 pb-3">
                  <p className="text-sm">
                    {r.id === rec.route_id ? (
                      <>
                        <span className="font-semibold text-primary">Recommended. </span>
                        {rec.reason}
                        {extra > 60 && ` Costs +${formatDuration(extra)}${r.distance_mi > fastest.distance_mi ? ` and +${formatMiles(r.distance_mi - fastest.distance_mi)}` : ''} against ${fastest.label}.`}
                      </>
                    ) : (
                      <span className="text-muted-foreground">{versusPick(r, s, pick, option.summaries[pick.id])}</span>
                    )}
                  </p>
                  <RiskStrip route={r} states={states} hoveredIndex={hoveredCheckpoint} onHover={onHoverCheckpoint} showTicks />
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                    <span className="text-muted-foreground">Arrive {formatTime(departureMs + r.duration_s * 1000)}</span>
                    {RISK_LEVELS.slice(1)
                      .filter((l) => s.miles_by_level[l.key] > 0)
                      .reverse()
                      .map((l) => (
                        <span key={l.key} className="font-semibold" style={{ color: l.color }}>
                          {formatMiles(s.miles_by_level[l.key])} {l.label}
                        </span>
                      ))}
                    <span className="text-muted-foreground">measured every {interval} mi</span>
                  </div>
                </div>
              )}
            </div>
          )
        })}
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

      <div className="flex-1" />
      <div className="sticky bottom-0 -mx-1 bg-background/95 px-1 pt-2 pb-1 backdrop-blur">
        <Button size="lg" className="h-11 w-full" onClick={start} variant={live ? 'default' : 'secondary'}>
          {live ? <NavigationIcon data-icon="inline-start" /> : <PlayCircleIcon data-icon="inline-start" />}
          {live ? 'Start now' : `Preview drive · leave ${formatTime(departureMs)}`}
        </Button>
        {!live && <p className="mt-1.5 text-center text-xs text-muted-foreground">Live guidance starts when you move the Leave pin to now.</p>}
      </div>

      <StartDialog
        open={confirm}
        onOpenChange={setConfirm}
        plan={plan}
        interval={interval}
        route={route}
        departureMs={departureMs}
        onSwitchRoute={(id) => (onSelectRoute(id), setConfirm(false))}
        onLeaveLater={(ms) => (onDepartureChange(ms), setConfirm(false))}
        onStartAnyway={() => (setConfirm(false), onStart(live ? 'live' : 'preview'))}
      />
    </div>
  )
}

function Ranking({ routes, summaries, deciding }: { routes: Route[]; summaries: Record<string, RouteSummary>; deciding: Criterion | null }) {
  const rows: { key: Criterion; value: (r: Route) => number; show: (r: Route) => string }[] = [
    { key: 'no_travel_miles', value: (r) => summaries[r.id].miles_by_level.no_travel, show: (r) => formatMiles(summaries[r.id].miles_by_level.no_travel) },
    { key: 'severe_miles', value: (r) => summaries[r.id].miles_by_level.severe, show: (r) => formatMiles(summaries[r.id].miles_by_level.severe) },
    { key: 'high_miles', value: (r) => summaries[r.id].miles_by_level.high, show: (r) => formatMiles(summaries[r.id].miles_by_level.high) },
    { key: 'average_risk', value: (r) => summaries[r.id].average_risk, show: (r) => summaries[r.id].average_risk.toFixed(2) },
    { key: 'travel_time', value: (r) => r.duration_s, show: (r) => formatDuration(r.duration_s) },
  ]
  return (
    <>
      <Table className="text-xs">
        <TableHeader>
          <TableRow>
            <TableHead className="h-8">Compared in order</TableHead>
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
                <TableCell className={cn('py-1.5', isDeciding ? 'font-semibold text-primary' : 'text-muted-foreground')}>
                  {i + 1}. {CRITERIA_LABELS[row.key]}
                  {isDeciding && ' · decides'}
                </TableCell>
                {routes.map((r) => (
                  <TableCell key={r.id} className={cn('py-1.5 text-right tabular-nums', row.value(r) === best ? 'font-semibold' : 'text-muted-foreground')}>
                    {row.show(r)}
                  </TableCell>
                ))}
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
      <p className="mt-2 text-xs text-muted-foreground">Each checkpoint covers half the gap to its neighbours. Average risk is mile-weighted: Low 0 … No Travel 4. No Travel miles rank first.</p>
    </>
  )
}

import { OctagonAlertIcon, TriangleAlertIcon } from 'lucide-react'
import type { Interval, Plan, Route } from '@/api/types'
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { formatMiles, formatTime } from '@/lib/format'
import { optionAt, routeStates, saferDeparture, severeAndWorse } from '@/lib/plan'

interface Props {
  open: boolean
  onOpenChange: (o: boolean) => void
  plan: Plan
  interval: Interval
  route: Route
  departureMs: number
  onSwitchRoute: (id: string) => void
  onLeaveLater: (ms: number) => void
  onStartAnyway: () => void
}

/**
 * Shown when Start is pressed on a route with Severe or No Travel miles. The
 * safer choices come first, and each says exactly what risk it still carries.
 */
export function StartDialog({ open, onOpenChange, plan, interval, route, departureMs, onSwitchRoute, onLeaveLater, onStartAnyway }: Props) {
  const option = optionAt(plan, interval, departureMs)
  const summary = option.summaries[route.id]
  const noTravel = summary.miles_by_level.no_travel > 0
  const first = routeStates(plan, route, interval, departureMs).find((s) => (s.level ?? 0) >= (noTravel ? 4 : 3))
  // Another route now, if it carries less Severe/No Travel than this one.
  const other = option.recommendation.ranking
    .filter((id) => id !== route.id)
    .map((id) => ({ route: plan.routes.find((r) => r.id === id)!, bad: severeAndWorse(option.summaries[id]) }))
    .sort((a, b) => a.bad - b.bad)[0]
  const better = other && other.bad < severeAndWorse(summary) ? other : null
  const later = saferDeparture(plan, interval, departureMs, route.id)
  const Icon = noTravel ? OctagonAlertIcon : TriangleAlertIcon

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Icon className={noTravel ? 'text-risk-no-travel' : 'text-risk-severe'} />
            {route.label} has {noTravel ? 'No Travel' : 'Severe'} weather
          </AlertDialogTitle>
          <AlertDialogDescription>
            {noTravel ? `${formatMiles(summary.miles_by_level.no_travel)} No Travel` : `${formatMiles(summary.miles_by_level.severe)} Severe`} on this trip
            {first ? `, from about mile ${Math.round(first.mile)} around ${formatTime(first.eta)} (wind ${Math.round(first.wind)} mph, rain ${first.rain.toFixed(2)} in/hr, snow ${first.snow.toFixed(2)} in/hr)` : ''}.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex flex-col gap-2">
          {later && (
            <Button onClick={() => onLeaveLater(later.at)} className="h-auto flex-col items-start gap-0 py-2 text-left">
              <span>Leave at {formatTime(later.at)} instead</span>
              <span className="text-xs font-normal opacity-80">No Severe or No Travel on {plan.routes.find((r) => r.id === later.routeId)?.label}</span>
            </Button>
          )}
          {better && (
            <Button variant="secondary" onClick={() => onSwitchRoute(better.route.id)} className="h-auto flex-col items-start gap-0 py-2 text-left">
              <span>Switch to {better.route.label}</span>
              <span className="text-xs font-normal text-muted-foreground">{better.bad > 0 ? `Still ${formatMiles(better.bad)} Severe or worse` : 'No Severe or No Travel'}</span>
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Back
          </Button>
          <Button variant="ghost" className="text-destructive" onClick={onStartAnyway}>
            Start anyway
          </Button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  )
}

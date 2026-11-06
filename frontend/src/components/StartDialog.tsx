import { OctagonAlertIcon } from 'lucide-react'
import type { Interval, Plan, Route } from '@/api/types'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { formatMiles, formatTime } from '@/lib/format'
import { optionAt, routeStates, safeAlternatives } from '@/lib/plan'

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

/** Shown when Start is pressed on a route with No Travel miles: offer the safer choices first. */
export function StartDialog({ open, onOpenChange, plan, interval, route, departureMs, onSwitchRoute, onLeaveLater, onStartAnyway }: Props) {
  const summary = optionAt(plan, interval, departureMs).summaries[route.id]
  const first = routeStates(plan, route, interval, departureMs).find((s) => s.level === 4)
  const { otherRoute, laterDeparture } = safeAlternatives(plan, interval, route.id, departureMs)
  const other = plan.routes.find((r) => r.id === otherRoute)
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <OctagonAlertIcon className="text-risk-no-travel" />
            {route.label} has No Travel weather
          </AlertDialogTitle>
          <AlertDialogDescription>
            {formatMiles(summary.miles_by_level.no_travel)} of this trip is rated No Travel
            {first ? `, starting near mile ${Math.round(first.mile)} around ${formatTime(first.eta)} (wind ${Math.round(first.wind)} mph)` : ''}.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex flex-col gap-2">
          {other && <Button onClick={() => onSwitchRoute(other.id)}>Switch to {other.label}</Button>}
          {laterDeparture && (
            <Button variant="secondary" onClick={() => onLeaveLater(laterDeparture)}>
              Leave at {formatTime(laterDeparture)} instead
            </Button>
          )}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Back</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onStartAnyway}>
            Start anyway
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

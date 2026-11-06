import { ArrowUpDownIcon, CircleDotIcon, MapPinIcon, PlusIcon, SlidersHorizontalIcon, XIcon } from 'lucide-react'
import type { FormEvent } from 'react'
import { INTERVALS, type Interval, type Place } from '@/api/types'
import { DepartureField } from '@/components/DepartureField'
import { PlaceField } from '@/components/PlaceField'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { DropdownLike } from '@/components/IntervalMenu'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from '@/components/ui/input-group'
import { Spinner } from '@/components/ui/spinner'
import { inRoutingRegion, REGION_MESSAGE } from '@/lib/location'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

export const MAX_STOPS = 3
const LEGAL_GROSS_LB = 80_000
const MAX_LOAD_LB = 200_000

export interface TripDraft {
  origin: Place | null
  destination: Place | null
  stops: (Place | null)[]
  departure: Date
  load: string
}

export function loadError(load: string): string | null {
  if (load.trim() === '') return 'Enter the load weight.'
  const n = Number(load)
  if (!Number.isFinite(n) || n < 0) return 'Enter a weight in pounds.'
  if (n > MAX_LOAD_LB) return `That's over ${MAX_LOAD_LB.toLocaleString()} lb.`
  return null
}

function outOfRegion(d: TripDraft): boolean {
  return [d.origin, d.destination, ...d.stops].some((p) => p && !inRoutingRegion(p))
}

export function draftIsValid(d: TripDraft): boolean {
  return !!d.origin && !!d.destination && !loadError(d.load) && d.stops.every(Boolean) && !outOfRegion(d)
}

interface Props {
  draft: TripDraft
  onDraftChange: (d: TripDraft) => void
  interval: Interval
  onIntervalChange: (i: Interval) => void
  loading: boolean
  error: string | null
  onSubmit: () => void
}

export function PlanPanel({ draft, onDraftChange, interval, onIntervalChange, loading, error, onSubmit }: Props) {
  const set = (patch: Partial<TripDraft>) => onDraftChange({ ...draft, ...patch })
  const loadMsg = loadError(draft.load)
  const heavy = !loadMsg && Number(draft.load) > LEGAL_GROSS_LB

  function submit(e: FormEvent) {
    e.preventDefault()
    if (draftIsValid(draft)) onSubmit()
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <FieldGroup className="gap-3">
        <div className="grid grid-cols-[1fr_auto] items-center gap-x-1">
          <div className="flex flex-col gap-2">
            <PlaceField label="Choose starting point" value={draft.origin} onChange={(origin) => set({ origin })} allowCurrentLocation icon={<CircleDotIcon className="text-primary" />} />
            {draft.stops.map((stop, i) => (
              <div key={i} className="flex items-start gap-1">
                <div className="flex-1">
                  <PlaceField
                    label={`Stop ${i + 1}`}
                    value={stop}
                    onChange={(p) => set({ stops: draft.stops.map((s, j) => (j === i ? p : s)) })}
                    icon={<CircleDotIcon className="text-risk-moderate" />}
                    autoFocus={!stop}
                  />
                </div>
                <Button type="button" variant="ghost" size="icon" className="size-10" aria-label={`Remove stop ${i + 1}`} onClick={() => set({ stops: draft.stops.filter((_, j) => j !== i) })}>
                  <XIcon />
                </Button>
              </div>
            ))}
            <PlaceField label="Choose destination" value={draft.destination} onChange={(destination) => set({ destination })} icon={<MapPinIcon className="text-risk-severe" />} />
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button type="button" variant="ghost" size="icon" aria-label="Swap start and destination" onClick={() => set({ origin: draft.destination, destination: draft.origin, stops: [...draft.stops].reverse() })}>
                <ArrowUpDownIcon />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Swap start and destination</TooltipContent>
          </Tooltip>
        </div>
        {draft.stops.length < MAX_STOPS && (
          <Button type="button" variant="ghost" size="sm" className="self-start text-muted-foreground" onClick={() => set({ stops: [...draft.stops, null] })}>
            <PlusIcon data-icon="inline-start" />
            Add stop
          </Button>
        )}

        <div className="grid grid-cols-[minmax(0,1fr)_9.5rem] gap-3">
          <Field>
            <FieldLabel>Departure</FieldLabel>
            <DepartureField value={draft.departure} onChange={(departure) => set({ departure })} />
          </Field>
          <Field data-invalid={!!loadMsg || undefined}>
            <FieldLabel htmlFor="load">Load</FieldLabel>
            <InputGroup className="h-10 bg-card">
              <InputGroupInput id="load" inputMode="numeric" value={draft.load} aria-invalid={!!loadMsg || undefined} onChange={(e) => set({ load: e.target.value.replace(/[^\d]/g, '') })} />
              <InputGroupAddon align="inline-end">
                <InputGroupText>lb</InputGroupText>
              </InputGroupAddon>
            </InputGroup>
            {loadMsg && <FieldError>{loadMsg}</FieldError>}
            {heavy && <FieldDescription>Over the 80,000 lb US gross limit.</FieldDescription>}
          </Field>
        </div>

        <DropdownLike
          icon={SlidersHorizontalIcon}
          label={`Checkpoints every ${interval} mi`}
          options={INTERVALS.map((v) => ({ value: v, label: `Every ${v} miles` }))}
          value={interval}
          onChange={onIntervalChange}
        />
      </FieldGroup>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {outOfRegion(draft) && <p className="text-center text-xs text-muted-foreground">{REGION_MESSAGE} Pick places there to find routes.</p>}
      <Button type="submit" size="lg" className="h-11" disabled={!draftIsValid(draft) || loading}>
        {loading && <Spinner data-icon="inline-start" />}
        {loading ? 'Checking routes and weather…' : 'Find routes'}
      </Button>
    </form>
  )
}

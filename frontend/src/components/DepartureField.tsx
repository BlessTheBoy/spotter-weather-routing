import { addDays, format, isSameDay, set, startOfDay } from 'date-fns'
import { CalendarClockIcon } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'

export const MAX_DAYS_AHEAD = 7

interface Props {
  value: Date
  onChange: (d: Date) => void
}

const TIMES = Array.from({ length: 96 }, (_, i) => ({ h: Math.floor(i / 4), m: (i % 4) * 15 }))

function roundUp15(d: Date): Date {
  const m = Math.ceil(d.getMinutes() / 15) * 15
  return set(d, { minutes: m, seconds: 0, milliseconds: 0 })
}

/** Departure picker: quick choices first, then a calendar and a 15-minute time list. */
export function DepartureField({ value, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const now = new Date()
  const max = addDays(now, MAX_DAYS_AHEAD)
  const clamp = (d: Date) => new Date(Math.min(max.getTime(), Math.max(now.getTime(), d.getTime())))
  const tomorrow = addDays(startOfDay(now), 1)
  const quick: { label: string; at: Date }[] = [
    { label: 'Now', at: now },
    { label: 'In 1 hour', at: roundUp15(new Date(now.getTime() + 3600_000)) },
    { label: 'Tonight 8 PM', at: set(now, { hours: 20, minutes: 0, seconds: 0, milliseconds: 0 }) },
    { label: 'Tomorrow 6 AM', at: set(tomorrow, { hours: 6 }) },
  ].filter((q) => q.at.getTime() >= now.getTime() - 60_000)

  const label = isSameDay(value, now) ? `Today, ${format(value, 'h:mm a')}` : format(value, 'EEE, MMM d · h:mm a')
  const timeKey = `${value.getHours()}:${Math.floor(value.getMinutes() / 15) * 15}`

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="h-10 w-full justify-start bg-card font-normal" aria-label={`Departure: ${label}`}>
          <CalendarClockIcon data-icon="inline-start" className="text-muted-foreground" />
          <span className="truncate">{label}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <div className="flex flex-wrap gap-1.5 p-3">
          {quick.map((q) => (
            <Button key={q.label} size="sm" variant="secondary" onClick={() => (onChange(clamp(q.at)), setOpen(false))}>
              {q.label}
            </Button>
          ))}
        </div>
        <Separator />
        <Calendar
          mode="single"
          selected={value}
          onSelect={(d) => d && onChange(clamp(set(d, { hours: value.getHours(), minutes: value.getMinutes() })))}
          disabled={{ before: startOfDay(now), after: max }}
          defaultMonth={value}
        />
        <Separator />
        <div className="flex items-center justify-between gap-3 p-3">
          <span className="text-sm text-muted-foreground">Time</span>
          <Select
            value={timeKey}
            onValueChange={(v) => {
              const [h, m] = v.split(':').map(Number)
              onChange(clamp(set(value, { hours: h, minutes: m, seconds: 0 })))
            }}
          >
            <SelectTrigger className="w-36" aria-label="Departure time">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-64">
              <SelectGroup>
                {TIMES.map(({ h, m }) => (
                  <SelectItem key={`${h}:${m}`} value={`${h}:${m}`}>
                    {format(set(value, { hours: h, minutes: m }), 'h:mm a')}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
        <p className="px-3 pb-3 text-xs text-muted-foreground">Up to {MAX_DAYS_AHEAD} days ahead. Forecasts past 3 days are less certain.</p>
      </PopoverContent>
    </Popover>
  )
}

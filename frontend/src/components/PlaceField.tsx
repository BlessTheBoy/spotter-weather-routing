import { Command as CommandPrimitive } from 'cmdk'
import { LocateFixedIcon, MapPinIcon } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { searchPlaces } from '@/api/client'
import type { Place } from '@/api/types'
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from '@/components/ui/command'
import { FieldError } from '@/components/ui/field'
import { InputGroup, InputGroupAddon } from '@/components/ui/input-group'
import { Spinner } from '@/components/ui/spinner'
import { describeCurrentLocation, inRoutingRegion, REGION_MESSAGE } from '@/lib/location'
import { cn } from '@/lib/utils'

interface Props {
  label: string
  value: Place | null
  onChange: (place: Place | null) => void
  /** Offer "Your location" (browser geolocation) as the first option. */
  allowCurrentLocation?: boolean
  icon: ReactNode
  autoFocus?: boolean
}

/** Search-as-you-type place picker. Keyboard: arrows to move, Enter to pick, Esc to close. */
export function PlaceField({ label, value, onChange, allowCurrentLocation, icon, autoFocus }: Props) {
  const [input, setInput] = useState(value?.label ?? '')
  const [options, setOptions] = useState<Place[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [locating, setLocating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => setInput(value?.label ?? ''), [value])

  useEffect(() => {
    if (!open || input.length < 2 || input === value?.label) return
    const ctrl = new AbortController()
    // Debounce typing so we send one search per pause, not per keystroke.
    const t = setTimeout(() => {
      setLoading(true)
      searchPlaces(input, ctrl.signal)
        .then(setOptions)
        .catch(() => {})
        .finally(() => setLoading(false))
    }, 250)
    return () => {
      clearTimeout(t)
      ctrl.abort()
    }
  }, [input, open, value?.label])

  function choose(place: Place) {
    setError(null)
    if (!inRoutingRegion(place)) setError(REGION_MESSAGE)
    onChange(place)
    setOpen(false)
    inputRef.current?.blur()
  }

  async function useMyLocation() {
    setOpen(false)
    setError(null)
    setLocating(true)
    try {
      const place = await describeCurrentLocation()
      if (!inRoutingRegion(place)) setError(`You're in ${place.label.replace(/^Your location · /, '')}. ${REGION_MESSAGE}`)
      onChange(place)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLocating(false)
    }
  }

  const showCurrent = allowCurrentLocation && (!input || input === value?.label)
  return (
    <div className="flex flex-col gap-1">
      <Command shouldFilter={false} className="relative overflow-visible bg-transparent">
        <InputGroup className="h-10 bg-card" data-invalid={!!error || undefined}>
          <InputGroupAddon>{locating ? <Spinner /> : icon}</InputGroupAddon>
          <CommandPrimitive.Input
            ref={inputRef}
            data-slot="input-group-control"
            aria-label={label}
            aria-invalid={!!error || undefined}
            placeholder={label}
            autoFocus={autoFocus}
            value={input}
            onValueChange={(v) => {
              setInput(v)
              setOpen(true)
            }}
            onFocus={(e) => {
              e.currentTarget.select()
              setOpen(true)
            }}
            onBlur={() => setTimeout(() => setOpen(false), 120)}
            onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
            className="h-full flex-1 truncate bg-transparent px-2 text-sm outline-none placeholder:text-muted-foreground"
          />
        </InputGroup>
        <CommandList
          className={cn(
            'absolute top-full right-0 left-0 z-50 mt-1 max-h-72 rounded-lg border bg-popover text-popover-foreground shadow-lg',
            !open && 'hidden',
          )}
        >
          {input.length >= 2 && input !== value?.label && !loading && <CommandEmpty>No matches</CommandEmpty>}
          <CommandGroup>
            {showCurrent && (
              <CommandItem value="__current" onSelect={useMyLocation} onMouseDown={(e) => e.preventDefault()}>
                <LocateFixedIcon className="text-primary" />
                Your location
              </CommandItem>
            )}
            {(input !== value?.label ? options : []).map((o) => (
              <CommandItem key={`${o.lat},${o.lng}`} value={`${o.lat},${o.lng}`} onSelect={() => choose(o)} onMouseDown={(e) => e.preventDefault()}>
                <MapPinIcon className="text-muted-foreground" />
                <span className="truncate">{o.label}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </Command>
      {error && <FieldError className="px-1 text-xs">{error}</FieldError>}
    </div>
  )
}

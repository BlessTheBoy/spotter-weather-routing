import { ChevronDownIcon, ChevronUpIcon } from 'lucide-react'
import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'

interface Props {
  expanded: boolean
  onExpandedChange: (expanded: boolean) => void
  /** The first row, shown in both states; give it the short version when minimized. */
  header: ReactNode
  children: ReactNode
  /** Reports the deck's height so the map can keep the routes clear of it. */
  onHeightChange?: (px: number) => void
}

/**
 * Mobile controls in a card floating at the top of the map, like Google Maps'
 * directions box. It folds down to its first row so the map gets the screen.
 */
export function TopDeck({ expanded, onExpandedChange, header, children, onHeightChange }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !onHeightChange) return
    const ro = new ResizeObserver(() => onHeightChange(el.offsetHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [onHeightChange])

  return (
    <div ref={ref} className="absolute inset-x-3 top-[max(0.75rem,env(safe-area-inset-top))] z-30 rounded-2xl border bg-popover/95 shadow-xl backdrop-blur">
      <div className="flex min-h-12 items-center gap-1 py-1 pr-1 pl-3">
        {header}
        <Button
          variant="ghost"
          size="icon"
          className="size-10 shrink-0"
          onClick={() => onExpandedChange(!expanded)}
          aria-expanded={expanded}
          aria-label={expanded ? 'Minimize controls' : 'Show controls'}
        >
          {expanded ? <ChevronUpIcon /> : <ChevronDownIcon />}
        </Button>
      </div>
      {expanded && <div className="flex animate-in flex-col gap-2.5 px-3 pb-3 duration-200 fade-in-0 slide-in-from-top-1">{children}</div>}
    </div>
  )
}

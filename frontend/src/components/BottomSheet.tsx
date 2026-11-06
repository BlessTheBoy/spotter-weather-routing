import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

export type SheetSnap = 'peek' | 'initial' | 'full'

const PEEK = 120
const HANDLE = 28
const TOP_GAP = 56
/** The opening height follows the content, but never covers more than this share of the screen. */
const MAX_INITIAL = 0.6

interface Props {
  snap: SheetSnap
  onSnapChange: (s: SheetSnap) => void
  /** Changes when the sheet's content changes, so the opening height is re-measured. */
  contentKey: string
  children: ReactNode
  onHeightChange?: (px: number) => void
}

/**
 * Mobile panel in the Google Maps style. It opens at its content's height
 * (capped), can be dragged up to full height or down to a peek, and snaps by
 * flick direction as well as by position.
 */
export function BottomSheet({ snap, onSnapChange, contentKey, children, onHeightChange }: Props) {
  const content = useRef<HTMLDivElement>(null)
  const [contentH, setContentH] = useState(320)
  const [drag, setDrag] = useState<number | null>(null)
  const startY = useRef(0)
  const startH = useRef(0)
  const samples = useRef<{ y: number; t: number }[]>([])

  const vh = typeof window === 'undefined' ? 800 : window.innerHeight
  const safe = 16 // plus env(safe-area-inset-bottom) via padding below
  const initial = Math.min(Math.round(vh * MAX_INITIAL), contentH + HANDLE + safe)
  const heights: Record<SheetSnap, number> = { peek: PEEK, initial, full: vh - TOP_GAP }
  const height = drag ?? heights[snap]

  useLayoutEffect(() => {
    const el = content.current
    if (!el) return
    const measure = () => setContentH(el.scrollHeight)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [contentKey])

  useEffect(() => onHeightChange?.(heights[snap]), [snap, initial]) // eslint-disable-line react-hooks/exhaustive-deps

  function down(e: React.PointerEvent) {
    startY.current = e.clientY
    startH.current = height
    samples.current = [{ y: e.clientY, t: performance.now() }]
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    setDrag(height)
  }
  function move(e: React.PointerEvent) {
    if (drag == null) return
    samples.current = [...samples.current.slice(-4), { y: e.clientY, t: performance.now() }]
    setDrag(Math.max(PEEK - 40, Math.min(vh - TOP_GAP, startH.current + startY.current - e.clientY)))
  }
  function up() {
    if (drag == null) return
    const s = samples.current
    const v = s.length > 1 ? (s[0].y - s[s.length - 1].y) / Math.max(1, s[s.length - 1].t - s[0].t) : 0 // px/ms, + = upward
    const order: SheetSnap[] = ['peek', 'initial', 'full']
    let target: SheetSnap
    if (Math.abs(v) > 0.4) {
      // A flick moves one step in its direction from wherever the drag started.
      const from = order.reduce((b, k) => (Math.abs(heights[k] - startH.current) < Math.abs(heights[b] - startH.current) ? k : b), snap)
      target = order[Math.min(2, Math.max(0, order.indexOf(from) + (v > 0 ? 1 : -1)))]
    } else {
      target = order.reduce((b, k) => (Math.abs(heights[k] - drag) < Math.abs(heights[b] - drag) ? k : b), snap)
    }
    setDrag(null)
    onSnapChange(target)
  }

  return (
    <div
      className={cn('absolute inset-x-0 bottom-0 z-30 flex flex-col rounded-t-2xl border-t bg-background shadow-[0_-8px_24px_rgba(0,0,0,0.45)]', drag == null && 'transition-[height] duration-200 ease-out')}
      style={{ height }}
    >
      <div
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        role="button"
        tabIndex={0}
        aria-label="Resize panel"
        onKeyDown={(e) => (e.key === 'ArrowUp' ? onSnapChange(snap === 'peek' ? 'initial' : 'full') : e.key === 'ArrowDown' ? onSnapChange(snap === 'full' ? 'initial' : 'peek') : null)}
        className="flex shrink-0 cursor-grab touch-none justify-center py-3 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <div className="h-1 w-10 rounded-full bg-foreground/25" />
      </div>
      <div className={cn('flex-1 px-4 pb-[max(1rem,env(safe-area-inset-bottom))]', snap === 'full' || contentH + HANDLE + safe > initial ? 'overflow-y-auto' : 'overflow-hidden')}>
        <div ref={content}>{children}</div>
      </div>
    </div>
  )
}

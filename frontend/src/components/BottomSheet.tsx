import { Box } from '@mui/material'
import { useEffect, useRef, useState, type ReactNode } from 'react'

export type SheetSnap = 'peek' | 'half' | 'full'

const HEIGHT: Record<SheetSnap, string> = { peek: '132px', half: '52vh', full: 'calc(100vh - 56px)' }

interface Props {
  snap: SheetSnap
  onSnapChange: (s: SheetSnap) => void
  children: ReactNode
}

/** Mobile panel in the Google Maps style: drag the handle between peek, half and full. */
export function BottomSheet({ snap, onSnapChange, children }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<number | null>(null)
  const startY = useRef(0)
  const startH = useRef(0)

  useEffect(() => setDrag(null), [snap])

  function onPointerDown(e: React.PointerEvent) {
    startY.current = e.clientY
    startH.current = ref.current!.getBoundingClientRect().height
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    setDrag(startH.current)
  }
  function onPointerMove(e: React.PointerEvent) {
    if (drag == null) return
    setDrag(Math.max(96, Math.min(window.innerHeight - 56, startH.current + startY.current - e.clientY)))
  }
  function onPointerUp() {
    if (drag == null) return
    const vh = window.innerHeight
    // Snap to the nearest resting height.
    const options: [SheetSnap, number][] = [
      ['peek', 132],
      ['half', vh * 0.52],
      ['full', vh - 56],
    ]
    const nearest = options.reduce((b, o) => (Math.abs(o[1] - drag) < Math.abs(b[1] - drag) ? o : b))
    setDrag(null)
    onSnapChange(nearest[0])
  }

  return (
    <Box
      ref={ref}
      sx={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        height: drag != null ? `${drag}px` : HEIGHT[snap],
        transition: drag != null ? 'none' : 'height 220ms cubic-bezier(.2,.8,.2,1)',
        bgcolor: 'background.default',
        borderRadius: '16px 16px 0 0',
        boxShadow: '0 -8px 24px rgba(0,0,0,0.45)',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 3,
      }}
    >
      <Box
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onClick={() => drag == null && onSnapChange(snap === 'peek' ? 'half' : snap === 'half' ? 'full' : 'half')}
        role="button"
        aria-label="Resize panel"
        sx={{ py: 1.25, cursor: 'grab', touchAction: 'none', flexShrink: 0 }}
      >
        <Box sx={{ width: 40, height: 4, borderRadius: 2, bgcolor: 'rgba(255,255,255,0.25)', mx: 'auto' }} />
      </Box>
      <Box sx={{ flex: 1, overflowY: 'auto', px: 2, pb: 2 }}>{children}</Box>
    </Box>
  )
}

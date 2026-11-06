import { Box, Tooltip } from '@mui/material'
import type { Route } from '../api/types'
import { formatTime } from '../lib/format'
import { riskColor, riskLabel } from '../lib/risk'

interface Props {
  route: Route
  height?: number
  hoveredIndex?: number | null
  onHover?: (index: number | null) => void
  showTicks?: boolean
}

/**
 * The route laid out by distance, each checkpoint's stretch coloured by its
 * risk at the truck's ETA. Hovering a stretch highlights it on the map.
 */
export function RiskStrip({ route, height = 10, hoveredIndex, onHover, showTicks }: Props) {
  const cps = route.checkpoints
  const total = route.distance_mi || 1
  return (
    <Box>
      <Box sx={{ display: 'flex', height, borderRadius: 1, overflow: 'hidden', bgcolor: 'rgba(255,255,255,0.05)' }} onMouseLeave={() => onHover?.(null)}>
        {cps.map((cp, i) => (
          <Tooltip
            key={i}
            disableInteractive
            placement="top"
            title={`Mile ${cp.mile.toFixed(0)} · ${riskLabel(cp.level)} · ETA ${formatTime(cp.eta)}`}
          >
            <Box
              onMouseEnter={() => onHover?.(i)}
              sx={{
                width: `${(cp.represents_mi / total) * 100}%`,
                bgcolor: riskColor(cp.level),
                opacity: hoveredIndex == null || hoveredIndex === i ? 1 : 0.55,
                transition: 'opacity 120ms',
                cursor: onHover ? 'pointer' : 'default',
              }}
            />
          </Tooltip>
        ))}
      </Box>
      {showTicks && <Ticks route={route} />}
    </Box>
  )
}

function Ticks({ route }: { route: Route }) {
  // Start, two thirds-points and the destination, each snapped to its nearest checkpoint.
  const n = 3
  const cps = route.checkpoints
  const picks = Array.from({ length: n + 1 }, (_, i) => {
    const target = (i / n) * route.distance_mi
    return cps.reduce((best, cp) => (Math.abs(cp.mile - target) < Math.abs(best.mile - target) ? cp : best))
  })
  return (
    <Box sx={{ position: 'relative', height: 30, mt: 0.5, fontSize: 11, color: 'text.secondary' }}>
      {picks.map((cp, i) => (
        <Box
          key={i}
          sx={{
            position: 'absolute',
            left: `${(cp.mile / (route.distance_mi || 1)) * 100}%`,
            transform: i === 0 ? 'none' : i === n ? 'translateX(-100%)' : 'translateX(-50%)',
            textAlign: i === 0 ? 'left' : i === n ? 'right' : 'center',
            whiteSpace: 'nowrap',
            lineHeight: 1.3,
          }}
        >
          {cp.mile.toFixed(0)} mi
          <br />
          {formatTime(cp.eta)}
        </Box>
      ))}
    </Box>
  )
}

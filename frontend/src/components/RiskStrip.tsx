import { Box, Tooltip } from '@mui/material'
import type { Route } from '../api/types'
import { formatTime } from '../lib/format'
import type { CheckpointState } from '../lib/plan'
import { riskColor, riskLabel } from '../lib/risk'

interface Props {
  route: Route
  states: CheckpointState[]
  height?: number
  hoveredIndex?: number | null
  onHover?: (index: number | null) => void
  showTicks?: boolean
}

/**
 * The route laid out by distance, each checkpoint's stretch coloured by its
 * risk at the truck's ETA. Hovering a stretch highlights it on the map.
 */
export function RiskStrip({ route, states, height = 10, hoveredIndex, onHover, showTicks }: Props) {
  const total = route.distance_mi || 1
  return (
    <Box>
      <Box sx={{ display: 'flex', height, borderRadius: 1, overflow: 'hidden', bgcolor: 'rgba(255,255,255,0.05)' }} onMouseLeave={() => onHover?.(null)}>
        {states.map((cp) => (
          <Tooltip key={cp.index} disableInteractive placement="top" title={onHover ? `Mile ${cp.mile.toFixed(0)} · ${riskLabel(cp.level)} · ETA ${formatTime(cp.eta)}` : ''}>
            <Box
              onMouseEnter={() => onHover?.(cp.index)}
              sx={{
                width: `${(cp.represents_mi / total) * 100}%`,
                bgcolor: riskColor(cp.level),
                opacity: hoveredIndex == null || hoveredIndex === cp.index ? 1 : 0.5,
                transition: 'opacity 120ms, background-color 200ms',
                cursor: onHover ? 'pointer' : 'default',
              }}
            />
          </Tooltip>
        ))}
      </Box>
      {showTicks && <Ticks route={route} states={states} />}
    </Box>
  )
}

function Ticks({ route, states }: { route: Route; states: CheckpointState[] }) {
  // Start, the thirds and the destination, each snapped to its nearest checkpoint.
  const picks = [0, 1, 2, 3].map((i) => {
    const target = (i / 3) * route.distance_mi
    return states.reduce((best, cp) => (Math.abs(cp.mile - target) < Math.abs(best.mile - target) ? cp : best))
  })
  return (
    <Box sx={{ position: 'relative', height: 30, mt: 0.5, fontSize: 11, color: 'text.secondary' }}>
      {picks.map((cp, i) => (
        <Box
          key={i}
          sx={{
            position: 'absolute',
            left: `${(cp.mile / (route.distance_mi || 1)) * 100}%`,
            transform: i === 0 ? 'none' : i === 3 ? 'translateX(-100%)' : 'translateX(-50%)',
            textAlign: i === 0 ? 'left' : i === 3 ? 'right' : 'center',
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

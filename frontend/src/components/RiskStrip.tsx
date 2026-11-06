import type { Route } from '@/api/types'
import { formatTime } from '@/lib/format'
import type { CheckpointState } from '@/lib/plan'
import { riskColor, riskLabel } from '@/lib/risk'

interface Props {
  route: Route
  states: CheckpointState[]
  hoveredIndex?: number | null
  onHover?: (index: number | null) => void
  showTicks?: boolean
}

/**
 * The route laid out by distance, each checkpoint's stretch coloured by its
 * risk. Hovering a stretch opens that checkpoint's popup on the map.
 */
export function RiskStrip({ route, states, hoveredIndex, onHover, showTicks }: Props) {
  const total = route.distance_mi || 1
  return (
    <div>
      <div className="flex h-2.5 overflow-hidden rounded-full bg-muted" onMouseLeave={() => onHover?.(null)} role="list" aria-label="Risk along the route">
        {states.map((cp) => (
          <div
            key={cp.index}
            role="listitem"
            aria-label={`Mile ${cp.mile.toFixed(0)}, ${riskLabel(cp.level)}, ETA ${formatTime(cp.eta)}`}
            onMouseEnter={() => onHover?.(cp.index)}
            onClick={() => onHover?.(cp.index)}
            className="h-full cursor-pointer transition-opacity"
            style={{
              width: `${(cp.represents_mi / total) * 100}%`,
              background: riskColor(cp.level),
              opacity: hoveredIndex == null || hoveredIndex === cp.index ? 1 : 0.45,
            }}
          />
        ))}
      </div>
      {showTicks && <Ticks route={route} states={states} />}
    </div>
  )
}

function Ticks({ route, states }: { route: Route; states: CheckpointState[] }) {
  // Start, the thirds and the destination, each snapped to its nearest checkpoint.
  const picks = [0, 1, 2, 3].map((i) => {
    const target = (i / 3) * route.distance_mi
    return states.reduce((best, cp) => (Math.abs(cp.mile - target) < Math.abs(best.mile - target) ? cp : best))
  })
  return (
    <div className="relative mt-1 h-7 text-[11px] leading-tight text-muted-foreground">
      {picks.map((cp, i) => (
        <div
          key={i}
          className="absolute whitespace-nowrap"
          style={{
            left: `${(cp.mile / (route.distance_mi || 1)) * 100}%`,
            transform: i === 0 ? 'none' : i === 3 ? 'translateX(-100%)' : 'translateX(-50%)',
            textAlign: i === 0 ? 'left' : i === 3 ? 'right' : 'center',
          }}
        >
          {cp.mile.toFixed(0)} mi
          <br />
          {formatTime(cp.eta)}
        </div>
      ))}
    </div>
  )
}

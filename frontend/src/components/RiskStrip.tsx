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
            onPointerDown={() => onHover?.(cp.index)}
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
  // Only the ends: the departure time lives on the timeline's Leave flag, and hovering a stretch shows the rest.
  const last = states[states.length - 1]
  return (
    <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
      <span>0 mi</span>
      <span>
        {route.distance_mi.toFixed(0)} mi{last ? ` · ${formatTime(last.eta)}` : ''}
      </span>
    </div>
  )
}

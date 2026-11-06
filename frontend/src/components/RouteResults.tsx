import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import { Alert, Box, Card, CardActionArea, Chip, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material'
import type { Criterion, Plan, Route } from '../api/types'
import { formatDuration, formatMiles, formatTime } from '../lib/format'
import { CRITERIA_LABELS, RISK_LEVELS, riskColor } from '../lib/risk'
import { RiskStrip } from './RiskStrip'

interface Props {
  plan: Plan
  selectedRouteId: string
  onSelectRoute: (id: string) => void
  hoveredCheckpoint: { routeId: string; index: number } | null
  onHoverCheckpoint: (cp: { routeId: string; index: number } | null) => void
}

export function RouteResults({ plan, selectedRouteId, onSelectRoute, hoveredCheckpoint, onHoverCheckpoint }: Props) {
  const rec = plan.recommendation
  const recommended = plan.routes.find((r) => r.id === rec.route_id)!
  const risky = recommended.summary.max_level >= 3
  const notes = [...new Set(plan.routes.flatMap((r) => r.notes))]

  return (
    <Stack spacing={2}>
      <Alert
        icon={risky ? <WarningAmberIcon /> : <CheckCircleIcon />}
        severity={risky ? 'warning' : 'success'}
        variant="outlined"
        sx={{ borderColor: risky ? undefined : 'primary.dark', '& .MuiAlert-icon': { color: risky ? undefined : 'primary.light' } }}
      >
        <Typography variant="subtitle2">Take {recommended.label}</Typography>
        <Typography variant="body2">{rec.reason}</Typography>
        {risky && (
          <Typography variant="body2" sx={{ mt: 0.5 }}>
            Even the best option crosses {recommended.summary.max_level === 4 ? 'No Travel' : 'Severe'} weather. Try a later departure with the slider.
          </Typography>
        )}
      </Alert>

      <Stack spacing={1}>
        {rec.ranking.map((id) => {
          const route = plan.routes.find((r) => r.id === id)!
          return (
            <RouteCard
              key={id}
              route={route}
              recommended={id === rec.route_id}
              selected={id === selectedRouteId}
              onSelect={() => onSelectRoute(id)}
              hoveredIndex={hoveredCheckpoint?.routeId === id ? hoveredCheckpoint.index : null}
              onHover={(index) => onHoverCheckpoint(index == null ? null : { routeId: id, index })}
            />
          )
        })}
      </Stack>

      <Comparison plan={plan} />

      {(notes.length > 0 || plan.departure_adjusted) && (
        <Stack spacing={0.5}>
          {plan.departure_adjusted && <Note>Departure was in the past, so it was moved to now.</Note>}
          {notes.map((n) => (
            <Note key={n}>{n}</Note>
          ))}
        </Stack>
      )}
    </Stack>
  )
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <Typography variant="caption" color="text.secondary">
      {children}
    </Typography>
  )
}

interface CardProps {
  route: Route
  recommended: boolean
  selected: boolean
  onSelect: () => void
  hoveredIndex: number | null
  onHover: (index: number | null) => void
}

function RouteCard({ route, recommended, selected, onSelect, hoveredIndex, onHover }: CardProps) {
  const m = route.summary.miles_by_level
  return (
    <Card
      variant="outlined"
      sx={{
        borderColor: selected ? 'primary.main' : 'divider',
        bgcolor: selected ? 'rgba(32,178,170,0.07)' : 'background.paper',
        transition: 'border-color 150ms, background-color 150ms',
      }}
    >
      <CardActionArea onClick={onSelect} sx={{ p: 1.5 }} aria-pressed={selected} aria-label={`Show ${route.label}${recommended ? ", recommended" : ""}`}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1 }}>
          <Typography variant="subtitle2">{route.label}</Typography>
          {recommended && <Chip size="small" color="primary" label="Recommended" sx={{ height: 20, fontWeight: 700 }} />}
          <Box sx={{ flex: 1 }} />
          <Typography variant="subtitle2">{formatDuration(route.duration_s)}</Typography>
        </Stack>
        <RiskStrip route={route} hoveredIndex={hoveredIndex} onHover={selected ? onHover : undefined} showTicks={selected} />
        <Stack direction="row" spacing={1.5} sx={{ mt: selected ? 0.5 : 1, color: 'text.secondary', fontSize: 13 }}>
          <span>{formatMiles(route.distance_mi)}</span>
          <span>Arrive {formatTime(route.arrival)}</span>
          <Box sx={{ flex: 1 }} />
          {RISK_LEVELS.slice(2)
            .filter((r) => m[r.key] > 0)
            .map((r) => (
              <Box key={r.key} component="span" sx={{ color: r.color, fontWeight: 700 }}>
                {formatMiles(m[r.key])} {r.label}
              </Box>
            ))}
        </Stack>
      </CardActionArea>
    </Card>
  )
}

/** The brief's ranking, one row per criterion, winner highlighted. */
function Comparison({ plan }: { plan: Plan }) {
  const routes = plan.recommendation.ranking.map((id) => plan.routes.find((r) => r.id === id)!)
  const deciding = plan.recommendation.deciding_criterion
  const rows: { key: Criterion; value: (r: Route) => number; show: (r: Route) => string }[] = [
    { key: 'no_travel_miles', value: (r) => r.summary.miles_by_level.no_travel, show: (r) => formatMiles(r.summary.miles_by_level.no_travel) },
    { key: 'severe_miles', value: (r) => r.summary.miles_by_level.severe, show: (r) => formatMiles(r.summary.miles_by_level.severe) },
    { key: 'high_miles', value: (r) => r.summary.miles_by_level.high, show: (r) => formatMiles(r.summary.miles_by_level.high) },
    { key: 'average_risk', value: (r) => r.summary.average_risk, show: (r) => r.summary.average_risk.toFixed(2) },
    { key: 'travel_time', value: (r) => r.duration_s, show: (r) => formatDuration(r.duration_s) },
  ]
  return (
    <Box>
      <Typography variant="overline" color="text.secondary">
        How the routes rank
      </Typography>
      <Table size="small" sx={{ '& td, & th': { px: 1, borderColor: 'divider' } }}>
        <TableHead>
          <TableRow>
            <TableCell>Compared in order</TableCell>
            {routes.map((r) => (
              <TableCell key={r.id} align="right">
                {r.label.replace('Route ', '')}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row, i) => {
            const best = Math.min(...routes.map(row.value))
            const isDeciding = row.key === deciding
            return (
              <TableRow key={row.key} sx={{ bgcolor: isDeciding ? 'rgba(32,178,170,0.10)' : undefined }}>
                <TableCell sx={{ color: isDeciding ? 'primary.light' : 'text.secondary', fontWeight: isDeciding ? 700 : 400 }}>
                  {i + 1}. {CRITERIA_LABELS[row.key]}
                  {isDeciding && ' · decides'}
                </TableCell>
                {routes.map((r) => (
                  <TableCell key={r.id} align="right" sx={{ fontWeight: row.value(r) === best ? 700 : 400, color: row.value(r) === best ? 'text.primary' : 'text.secondary' }}>
                    {row.show(r)}
                  </TableCell>
                ))}
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
        Each checkpoint covers half the gap to its neighbours. Average risk is mile-weighted: Low 0, Moderate 1, High 2, Severe 3, No Travel 4.{' '}
        <Box component="span" sx={{ color: riskColor(4) }}>
          No Travel
        </Box>{' '}
        miles are ranked first.
      </Typography>
    </Box>
  )
}

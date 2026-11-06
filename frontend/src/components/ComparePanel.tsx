import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import NavigationIcon from '@mui/icons-material/Navigation'
import StarIcon from '@mui/icons-material/Star'
import { Accordion, AccordionDetails, AccordionSummary, Alert, Box, Button, ButtonBase, IconButton, Stack, Table, TableBody, TableCell, TableHead, TableRow, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import { useMemo } from 'react'
import { INTERVALS, type Criterion, type Interval, type Plan, type Route, type RouteSummary } from '../api/types'
import { formatDuration, formatMiles, formatTime } from '../lib/format'
import { isNow, optionAt, routeStates } from '../lib/plan'
import { CRITERIA_LABELS, RISK_LEVELS, riskColor, riskLabel } from '../lib/risk'
import { RiskStrip } from './RiskStrip'

interface Props {
  plan: Plan
  interval: Interval
  onIntervalChange: (i: Interval) => void
  departureMs: number
  selectedRouteId: string
  onSelectRoute: (id: string) => void
  hoveredCheckpoint: number | null
  onHoverCheckpoint: (i: number | null) => void
  onEdit: () => void
  onStart: () => void
}

const shortPlace = (label: string) => label.split(',')[0]

export function ComparePanel(props: Props) {
  const { plan, interval, onIntervalChange, departureMs, selectedRouteId, onSelectRoute, hoveredCheckpoint, onHoverCheckpoint, onEdit, onStart } = props
  const option = optionAt(plan, interval, departureMs)
  const planned = optionAt(plan, interval, Date.parse(plan.timeline.departure))
  const rec = option.recommendation
  const pickChanged = planned.recommendation.route_id !== rec.route_id && Math.abs(Date.parse(planned.departure) - departureMs) > 30 * 60_000
  const longRange = departureMs > Date.parse(plan.timeline.long_range_after)
  const route = plan.routes.find((r) => r.id === selectedRouteId)!
  const states = useMemo(() => routeStates(plan, route, interval, departureMs), [plan, route, interval, departureMs])
  const summary = option.summaries[route.id]

  return (
    <Stack spacing={2} sx={{ minHeight: '100%' }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <IconButton onClick={onEdit} aria-label="Edit trip" edge="start">
          <ArrowBackIcon />
        </IconButton>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, lineHeight: 1.2 }} noWrap>
            {shortPlace(plan.origin.label)} → {shortPlace(plan.destination.label)}
          </Typography>
          <Typography variant="caption" color="text.secondary" noWrap component="div">
            {plan.stops.length ? `${plan.stops.length} stop${plan.stops.length > 1 ? 's' : ''} · ` : ''}
            {plan.load_lb.toLocaleString()} lb · leave {formatTime(departureMs)}
          </Typography>
        </Box>
      </Stack>

      <Stack spacing={0.75} role="radiogroup" aria-label="Route options">
        {rec.ranking.map((id) => {
          const r = plan.routes.find((x) => x.id === id)!
          return <RouteRow key={id} route={r} summary={option.summaries[id]} recommended={id === rec.route_id} selected={id === selectedRouteId} onSelect={() => onSelectRoute(id)} />
        })}
      </Stack>

      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography variant="body2" color="text.secondary">
          Checkpoint every
        </Typography>
        <ToggleButtonGroup size="small" exclusive value={interval} onChange={(_, v) => v && onIntervalChange(v)} aria-label="Checkpoint interval">
          {INTERVALS.map((v) => (
            <ToggleButton key={v} value={v} sx={{ px: 1.5, py: 0.25 }}>
              {v} mi
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </Stack>

      <Box>
        <Typography variant="body2" sx={{ mb: 1 }}>
          {route.id === rec.route_id ? (
            <>
              <Box component="span" sx={{ color: 'primary.light', fontWeight: 700 }}>
                Recommended.
              </Box>{' '}
              {rec.reason}
            </>
          ) : (
            <>
              {route.label} isn't the safest pick for this departure.{' '}
              <Box component="span" sx={{ color: 'text.secondary' }}>
                {plan.routes.find((r) => r.id === rec.route_id)!.label} is: {rec.reason}
              </Box>
            </>
          )}
        </Typography>
        <RiskStrip route={route} states={states} hoveredIndex={hoveredCheckpoint} onHover={onHoverCheckpoint} showTicks />
        <Stack direction="row" spacing={1.5} sx={{ mt: 0.5, flexWrap: 'wrap', rowGap: 0.5, fontSize: 13 }}>
          <Box component="span" sx={{ color: 'text.secondary' }}>
            Arrive {formatTime(departureMs + route.duration_s * 1000)}
          </Box>
          {RISK_LEVELS.slice(1)
            .filter((l) => summary.miles_by_level[l.key] > 0)
            .reverse()
            .map((l) => (
              <Box key={l.key} component="span" sx={{ color: l.color, fontWeight: 700 }}>
                {formatMiles(summary.miles_by_level[l.key])} {l.label}
              </Box>
            ))}
        </Stack>
      </Box>

      {pickChanged && (
        <Alert severity="info" variant="outlined" sx={{ py: 0 }}>
          Leaving at {formatTime(departureMs)} changes the pick from {plan.routes.find((r) => r.id === planned.recommendation.route_id)!.label} to {plan.routes.find((r) => r.id === rec.route_id)!.label}.
        </Alert>
      )}
      {longRange && (
        <Typography variant="caption" color="warning.light">
          Long-range forecast. Check again closer to departure.
        </Typography>
      )}

      <Accordion disableGutters elevation={0} sx={{ bgcolor: 'transparent', '&:before': { display: 'none' }, border: 1, borderColor: 'divider', borderRadius: 1 }}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography variant="body2">How the routes rank</Typography>
        </AccordionSummary>
        <AccordionDetails sx={{ pt: 0 }}>
          <Comparison plan={plan} summaries={option.summaries} ranking={rec.ranking} deciding={rec.deciding_criterion} />
        </AccordionDetails>
      </Accordion>

      <Box sx={{ flex: 1 }} />
      <Box sx={{ position: 'sticky', bottom: 0, pt: 1, pb: 0.5, bgcolor: 'background.default' }}>
        <Button fullWidth variant="contained" size="large" startIcon={<NavigationIcon />} onClick={onStart}>
          {isNow(departureMs) ? 'Start now' : `Start ${formatTime(departureMs)}`}
        </Button>
      </Box>
    </Stack>
  )
}

function RouteRow({ route, summary, recommended, selected, onSelect }: { route: Route; summary: RouteSummary; recommended: boolean; selected: boolean; onSelect: () => void }) {
  const worst = summary.max_level
  return (
    <ButtonBase
      onClick={onSelect}
      role="radio"
      aria-checked={selected}
      aria-label={`${route.label}, ${formatDuration(route.duration_s)}, worst ${riskLabel(worst)}${recommended ? ', recommended' : ''}`}
      sx={{
        display: 'grid',
        gridTemplateColumns: '10px 1fr auto',
        columnGap: 1.25,
        alignItems: 'center',
        textAlign: 'left',
        px: 1.5,
        py: 1,
        borderRadius: 1.5,
        border: 1,
        borderColor: selected ? 'primary.main' : 'divider',
        bgcolor: selected ? 'rgba(32,178,170,0.08)' : 'transparent',
        transition: 'background-color 150ms, border-color 150ms',
      }}
    >
      <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: riskColor(worst) }} />
      <Box sx={{ minWidth: 0 }}>
        <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
          <Typography variant="body2" sx={{ fontWeight: 700 }}>
            {route.label}
          </Typography>
          {recommended && <StarIcon sx={{ fontSize: 16, color: 'primary.light' }} aria-hidden />}
        </Stack>
        <Typography variant="caption" color="text.secondary" component="div" noWrap>
          {formatMiles(route.distance_mi)} · worst {riskLabel(worst)}
        </Typography>
      </Box>
      <Typography variant="body2" sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: worst >= 3 ? riskColor(worst) : 'text.primary' }}>
        {formatDuration(route.duration_s)}
      </Typography>
    </ButtonBase>
  )
}

/** The brief's ranking, one row per criterion, winner highlighted. */
function Comparison({ plan, summaries, ranking, deciding }: { plan: Plan; summaries: Record<string, RouteSummary>; ranking: string[]; deciding: Criterion | null }) {
  const routes = ranking.map((id) => plan.routes.find((r) => r.id === id)!)
  const rows: { key: Criterion; value: (r: Route) => number; show: (r: Route) => string }[] = [
    { key: 'no_travel_miles', value: (r) => summaries[r.id].miles_by_level.no_travel, show: (r) => formatMiles(summaries[r.id].miles_by_level.no_travel) },
    { key: 'severe_miles', value: (r) => summaries[r.id].miles_by_level.severe, show: (r) => formatMiles(summaries[r.id].miles_by_level.severe) },
    { key: 'high_miles', value: (r) => summaries[r.id].miles_by_level.high, show: (r) => formatMiles(summaries[r.id].miles_by_level.high) },
    { key: 'average_risk', value: (r) => summaries[r.id].average_risk, show: (r) => summaries[r.id].average_risk.toFixed(2) },
    { key: 'travel_time', value: (r) => r.duration_s, show: (r) => formatDuration(r.duration_s) },
  ]
  return (
    <Box>
      <Table size="small" sx={{ '& td, & th': { px: 0.75, borderColor: 'divider' } }}>
        <TableHead>
          <TableRow>
            <TableCell>In order</TableCell>
            {routes.map((r) => (
              <TableCell key={r.id} align="right">
                {r.id}
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
        Each checkpoint covers half the gap to its neighbours. Average risk is mile-weighted: Low 0 … No Travel 4. No Travel miles rank first.
      </Typography>
    </Box>
  )
}

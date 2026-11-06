import ThreeDRotationIcon from '@mui/icons-material/ThreeDRotation'
import { Alert, Box, Paper, Stack, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import { useMemo, useRef, useState } from 'react'
import { fetchPlan } from './api/client'
import type { Plan, PlanRequest } from './api/types'
import { ForecastBar } from './components/ForecastBar'
import { RouteResults } from './components/RouteResults'
import { TripForm } from './components/TripForm'
import { createClock } from './lib/clock'
import type { Layer } from './lib/forecast'
import { MapView } from './map/MapView'

type HoveredCheckpoint = { routeId: string; index: number } | null

export default function App() {
  const clock = useMemo(() => createClock(48), [])
  const [plan, setPlan] = useState<Plan | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null)
  const [hovered, setHovered] = useState<HoveredCheckpoint>(null)
  const [layer, setLayer] = useState<Layer>('risk')
  const [showHeatmap, setShowHeatmap] = useState(true)
  const [is3D, setIs3D] = useState(false)
  const inflight = useRef<AbortController | null>(null)

  async function submit(req: PlanRequest) {
    inflight.current?.abort()
    const ctrl = new AbortController()
    inflight.current = ctrl
    setLoading(true)
    setError(null)
    try {
      const next = await fetchPlan(req, ctrl.signal)
      clock.pause()
      // Start the slider at departure so the trucks sit at the origin.
      clock.set(Math.max(0, (Date.parse(next.departure) - Date.parse(next.corridor.hours[0])) / 3600_000))
      setHovered(null)
      setSelectedRouteId(next.recommendation.route_id)
      setPlan(next)
    } catch (e) {
      if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : 'Something went wrong.')
    } finally {
      if (inflight.current === ctrl) setLoading(false)
    }
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: { xs: 'column-reverse', md: 'row' }, height: '100%', bgcolor: 'background.default' }}>
      <Box
        component="aside"
        sx={{
          width: { md: 420 },
          flexShrink: 0,
          height: { xs: '50%', md: '100%' },
          overflowY: 'auto',
          borderRight: { md: 1 },
          borderColor: 'divider',
          p: 2.5,
        }}
      >
        <Stack spacing={2.5}>
          <Stack sx={{ alignItems: 'center' }} direction="row" spacing={1.25}>
            <Box component="img" src="/favicon.svg" alt="" sx={{ width: 30, height: 30 }} />
            <Box>
              <Typography variant="h1">Weather-Aware Truck Routing</Typography>
              <Typography variant="caption" color="text.secondary">
                Three routes, forecast at your ETA, ranked by risk
              </Typography>
            </Box>
          </Stack>
          <TripForm loading={loading} onSubmit={submit} />
          {error && <Alert severity="error">{error}</Alert>}
          {plan && selectedRouteId && (
            <RouteResults
              plan={plan}
              selectedRouteId={selectedRouteId}
              onSelectRoute={setSelectedRouteId}
              hoveredCheckpoint={hovered}
              onHoverCheckpoint={setHovered}
            />
          )}
          {!plan && !loading && (
            <Typography variant="body2" color="text.secondary">
              Pick a trip and load. We fetch three truck routes, check the forecast at each checkpoint for the hour your truck reaches it, and recommend the
              route with the fewest Severe miles, then High miles, then the lowest average risk, then the shortest time.
            </Typography>
          )}
        </Stack>
      </Box>

      <Box component="main" sx={{ position: 'relative', flex: 1, minHeight: 0 }}>
        <MapView
          plan={plan}
          selectedRouteId={selectedRouteId}
          onSelectRoute={setSelectedRouteId}
          layer={layer}
          showHeatmap={showHeatmap}
          is3D={is3D}
          clock={clock}
          hoveredCheckpoint={hovered}
          onHoverCheckpoint={setHovered}
        />
        <Paper elevation={6} sx={{ position: 'absolute', top: 12, left: 12, bgcolor: 'rgba(19,26,32,0.92)' }}>
          <ToggleButtonGroup size="small" exclusive value={is3D ? '3d' : '2d'} onChange={(_, v) => v && setIs3D(v === '3d')} aria-label="Map view">
            <ToggleButton value="2d" sx={{ px: 1.5 }}>
              2D
            </ToggleButton>
            <ToggleButton value="3d" sx={{ px: 1.5, gap: 0.5 }}>
              <ThreeDRotationIcon fontSize="small" /> 3D
            </ToggleButton>
          </ToggleButtonGroup>
        </Paper>
        {plan && (
          <Box sx={{ position: 'absolute', left: 12, right: { xs: 12, md: 56 }, bottom: 28 }}>
            <ForecastBar
              clock={clock}
              corridor={plan.corridor}
              departure={plan.departure}
              layer={layer}
              onLayerChange={setLayer}
              showHeatmap={showHeatmap}
              onShowHeatmapChange={setShowHeatmap}
            />
          </Box>
        )}
      </Box>
    </Box>
  )
}

import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward'
import NorthEastIcon from '@mui/icons-material/NorthEast'
import NorthWestIcon from '@mui/icons-material/NorthWest'
import PauseIcon from '@mui/icons-material/Pause'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import SportsScoreIcon from '@mui/icons-material/SportsScore'
import TurnLeftIcon from '@mui/icons-material/TurnLeft'
import TurnRightIcon from '@mui/icons-material/TurnRight'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import { Box, Button, IconButton, Paper, Stack, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import type { Instruction, Route } from '../api/types'
import { formatDuration, formatTime } from '../lib/format'
import { SPEEDS, type NavState } from '../lib/navigation'
import type { CheckpointState } from '../lib/plan'
import { riskColor, riskLabel } from '../lib/risk'

const ICON: Record<Instruction['maneuver'], typeof ArrowUpwardIcon> = {
  depart: ArrowUpwardIcon,
  straight: ArrowUpwardIcon,
  left: TurnLeftIcon,
  right: TurnRightIcon,
  slight_left: NorthWestIcon,
  slight_right: NorthEastIcon,
  arrive: SportsScoreIcon,
}

function distance(mi: number): string {
  if (mi < 0.2) return `${Math.round(mi * 5280 / 50) * 50} ft`
  return `${mi < 10 ? mi.toFixed(1) : Math.round(mi)} mi`
}

interface Props {
  route: Route
  nav: NavState
  states: CheckpointState[]
  departureMs: number
  onSpeedChange: (s: number) => void
  onTogglePlaying: () => void
  onEnd: () => void
}

export function NavigateOverlay({ route, nav, states, departureMs, onSpeedChange, onTogglePlaying, onEnd }: Props) {
  const ahead = route.instructions.filter((s) => s.mile > nav.mile + 0.01)
  const next = ahead[0] ?? route.instructions[route.instructions.length - 1]
  const then = ahead[1]
  const Icon = ICON[next.maneuver]
  const hazard = states.find((s) => s.mile > nav.mile && (s.level ?? 0) >= 2)
  const remainingS = Math.max(0, route.duration_s - nav.elapsedS)
  const clockMs = nav.source === 'gps' ? Date.now() : departureMs + nav.elapsedS * 1000
  const elements = hazard ? (['wind', 'rain', 'snow'] as const).filter((k) => (k === 'wind' ? Math.max(hazard.windLevel, hazard.loadLevel) : k === 'rain' ? hazard.rainLevel : hazard.snowLevel) === hazard.level) : []

  return (
    <>
      <Box sx={{ position: 'absolute', top: 12, left: 12, right: { xs: 12, md: 'auto' }, width: { md: 380 }, zIndex: 2 }}>
        <Paper elevation={10} sx={{ bgcolor: '#0F6E56', color: '#fff', px: 2, py: 1.5, borderRadius: 2 }}>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
            <Icon sx={{ fontSize: 40 }} />
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontSize: 26, fontWeight: 700, lineHeight: 1.1 }}>{nav.arrived ? 'Arrived' : distance(next.mile - nav.mile)}</Typography>
              <Typography sx={{ fontSize: 16, fontWeight: 500 }} noWrap>
                {nav.arrived ? route.label : next.text}
              </Typography>
            </Box>
          </Stack>
        </Paper>
        {then && !nav.arrived && (
          <Paper elevation={6} sx={{ mt: 0.5, px: 2, py: 0.5, bgcolor: '#085041', color: '#E1F5EE', width: 'fit-content', borderRadius: 1.5, fontSize: 13 }}>
            Then {then.text.toLowerCase()} in {distance(then.mile - next.mile)}
          </Paper>
        )}
        {hazard && !nav.arrived && (
          <Paper elevation={6} sx={{ mt: 1, px: 1.5, py: 0.75, bgcolor: 'rgba(19,26,32,0.95)', border: 2, borderColor: riskColor(hazard.level), width: 'fit-content', borderRadius: 1.5 }}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <WarningAmberIcon sx={{ color: riskColor(hazard.level), fontSize: 20 }} />
              <Typography variant="body2" sx={{ fontWeight: 700 }}>
                {riskLabel(hazard.level)} {elements.join(' and ')} in {distance(hazard.mile - nav.mile)} · {formatTime(hazard.eta)}
              </Typography>
            </Stack>
          </Paper>
        )}
      </Box>

      <Paper elevation={10} sx={{ position: 'absolute', left: 12, right: 12, bottom: 24, mx: 'auto', maxWidth: 720, zIndex: 2, px: 2, py: 1.25, bgcolor: 'rgba(19,26,32,0.96)', border: 1, borderColor: 'divider' }}>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
          <Box>
            <Typography sx={{ fontSize: 22, fontWeight: 700, color: 'primary.light', lineHeight: 1.1 }}>{formatDuration(remainingS)}</Typography>
            <Typography variant="caption" color="text.secondary">
              {distance(Math.max(0, route.distance_mi - nav.mile))} · ETA {formatTime(clockMs + remainingS * 1000)}
            </Typography>
          </Box>
          <Box sx={{ flex: 1 }} />
          {nav.source === 'simulated' && (
            <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
              <Box sx={{ px: 0.75, py: 0.25, borderRadius: 1, bgcolor: 'rgba(242,201,76,0.15)', color: '#F2C94C', fontSize: 11, fontWeight: 700, letterSpacing: 0.5 }} title={nav.reason ?? undefined}>
                SIMULATED
              </Box>
              <IconButton size="small" onClick={onTogglePlaying} aria-label={nav.playing ? 'Pause drive' : 'Resume drive'}>
                {nav.playing ? <PauseIcon fontSize="small" /> : <PlayArrowIcon fontSize="small" />}
              </IconButton>
              <ToggleButtonGroup size="small" exclusive value={nav.speed} onChange={(_, v) => v && onSpeedChange(v)} aria-label="Simulation speed">
                {SPEEDS.map((s) => (
                  <ToggleButton key={s} value={s} sx={{ px: 1, py: 0.1, fontSize: 12 }}>
                    {s}×
                  </ToggleButton>
                ))}
              </ToggleButtonGroup>
            </Stack>
          )}
          <Button variant="contained" color="error" onClick={onEnd}>
            End
          </Button>
        </Stack>
      </Paper>
    </>
  )
}

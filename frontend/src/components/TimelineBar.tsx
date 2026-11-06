import PauseIcon from '@mui/icons-material/Pause'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import { Box, IconButton, Paper, Stack, Switch, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from '@mui/material'
import { useRef, type PointerEvent as ReactPointerEvent } from 'react'
import type { Plan } from '../api/types'
import { useForecastHour, usePlaying, type Clock } from '../lib/clock'
import { LAYERS, type Layer } from '../lib/forecast'
import { formatTime } from '../lib/format'
import { RISK_LEVELS } from '../lib/risk'

const HOUR = 3600_000

interface Props {
  plan: Plan
  clock: Clock
  departureMs: number
  onDepartureChange: (ms: number) => void
  /** Selected route's driving time, drawn as the trip span after the pin. */
  tripDurationS: number
  layer: Layer
  onLayerChange: (l: Layer) => void
  showHeatmap: boolean
  onShowHeatmapChange: (on: boolean) => void
}

/**
 * One 48 h track, two handles. The round playhead is the forecast clock
 * (heatmap and truck positions). The flag is the departure: dragging it
 * re-times every route. It stops where the longest route would run off the
 * end of the track, so playback always covers the whole trip.
 */
export function TimelineBar({ plan, clock, departureMs, onDepartureChange, tripDurationS, layer, onLayerChange, showHeatmap, onShowHeatmapChange }: Props) {
  const hour = useForecastHour(clock)
  const playing = usePlaying(clock)
  const track = useRef<HTMLDivElement>(null)
  const t = plan.timeline
  const start = Date.parse(t.start)
  const span = Date.parse(t.end) - start
  const pct = (ms: number) => `${Math.min(100, Math.max(0, ((ms - start) / span) * 100))}%`
  const now = Date.parse(t.now)
  const depMin = Date.parse(t.departure_min)
  const depMax = Date.parse(t.departure_max)
  const steps = plan.schedule[10].map((o) => Date.parse(o.departure))
  const playMs = start + hour * HOUR

  function timeAt(clientX: number): number {
    const r = track.current!.getBoundingClientRect()
    return start + Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * span
  }

  function dragPlayhead(e: ReactPointerEvent) {
    e.preventDefault()
    clock.pause()
    const move = (x: number) => clock.set((timeAt(x) - start) / HOUR)
    move(e.clientX)
    const onMove = (ev: PointerEvent) => move(ev.clientX)
    const onUp = () => (window.removeEventListener('pointermove', onMove), window.removeEventListener('pointerup', onUp))
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  function dragPin(e: ReactPointerEvent) {
    e.preventDefault()
    e.stopPropagation()
    clock.pause()
    const snap = (ms: number) => steps.reduce((b, s) => (Math.abs(s - ms) < Math.abs(b - ms) ? s : b), steps[0])
    const move = (x: number) => {
      const ms = snap(timeAt(x))
      onDepartureChange(ms)
      clock.set((ms - start) / HOUR) // the forecast follows the pin while you drag it
    }
    const onMove = (ev: PointerEvent) => move(ev.clientX)
    const onUp = () => (window.removeEventListener('pointermove', onMove), window.removeEventListener('pointerup', onUp))
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  function nudgePin(dir: number) {
    const i = steps.findIndex((s) => s >= departureMs - 1)
    const next = steps[Math.min(steps.length - 1, Math.max(0, i + dir))]
    onDepartureChange(next)
    clock.set((next - start) / HOUR)
  }

  function play() {
    if (playing) return clock.pause()
    const tripEnd = departureMs + tripDurationS * 1000
    // Replay the trip from the pin unless the playhead is already inside it.
    if (playMs < departureMs || playMs >= Math.min(tripEnd, start + span) - HOUR) clock.set((departureMs - start) / HOUR)
    clock.play()
  }

  const ticks: number[] = []
  for (let ms = Math.ceil(start / (12 * HOUR)) * 12 * HOUR; ms <= start + span; ms += 12 * HOUR) ticks.push(ms)
  const longRange = Date.parse(t.long_range_after)

  return (
    <Paper elevation={8} sx={{ px: 2, pt: 1.25, pb: 1, bgcolor: 'rgba(19,26,32,0.94)', backdropFilter: 'blur(8px)', border: 1, borderColor: 'divider' }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}>
        <Tooltip title={playing ? 'Pause' : 'Play the trip from departure'}>
          <IconButton onClick={play} color="primary" aria-label={playing ? 'Pause forecast' : 'Play forecast'} size="small" sx={{ border: 1, borderColor: 'primary.dark' }}>
            {playing ? <PauseIcon /> : <PlayArrowIcon />}
          </IconButton>
        </Tooltip>
        <Box sx={{ minWidth: 150 }}>
          <Typography variant="subtitle2" sx={{ fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 }}>
            Forecast {formatTime(playMs)}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Leave {formatTime(departureMs)}
          </Typography>
        </Box>
        <Box sx={{ flex: 1 }} />
        <Switch size="small" checked={showHeatmap} onChange={(e) => onShowHeatmapChange(e.target.checked)} slotProps={{ input: { 'aria-label': 'Show weather layer' } }} />
        <ToggleButtonGroup size="small" exclusive value={layer} onChange={(_, v) => v && onLayerChange(v)} disabled={!showHeatmap} aria-label="Weather layer">
          {(Object.keys(LAYERS) as Layer[]).map((k) => (
            <ToggleButton key={k} value={k} sx={{ px: 1.1, py: 0.25 }}>
              {LAYERS[k].label}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </Stack>

      <Box sx={{ position: 'relative', mt: 2.5, mb: 2.75, mx: 1, touchAction: 'none' }}>
        <Box ref={track} onPointerDown={dragPlayhead} sx={{ position: 'relative', height: 8, borderRadius: 4, bgcolor: 'rgba(255,255,255,0.10)', cursor: 'pointer' }}>
          {now > start && <Box sx={{ position: 'absolute', left: 0, width: pct(now), top: 0, bottom: 0, borderRadius: '4px 0 0 4px', bgcolor: 'rgba(0,0,0,0.35)' }} />}
          {longRange < start + span && (
            <Box
              title="Long-range forecast"
              sx={{ position: 'absolute', left: pct(longRange), right: 0, top: 0, bottom: 0, borderRadius: '0 4px 4px 0', background: 'repeating-linear-gradient(45deg, transparent 0 4px, rgba(242,201,76,0.18) 4px 8px)' }}
            />
          )}
          {/* Pin can't go here: the longest route would run past the end of the track. */}
          <Box sx={{ position: 'absolute', left: pct(depMax), right: 0, top: -3, height: 2, bgcolor: 'rgba(255,255,255,0.15)' }} />
          <Box sx={{ position: 'absolute', left: pct(departureMs), width: `calc(${pct(departureMs + tripDurationS * 1000)} - ${pct(departureMs)})`, top: 0, bottom: 0, bgcolor: 'rgba(64,224,208,0.45)', borderRadius: 4 }} />
          <Box sx={{ position: 'absolute', left: 0, width: pct(playMs), top: 0, bottom: 0, borderRadius: 4, borderRight: '2px solid rgba(255,255,255,0.0)' }} />
        </Box>

        {now >= start && (
          <Box sx={{ position: 'absolute', left: pct(now), top: -18, transform: 'translateX(-50%)', fontSize: 10, color: 'text.secondary', pointerEvents: 'none' }}>
            Now
          </Box>
        )}

        <Tooltip title={`Departure · drag to leave earlier or later (${formatTime(depMin)} – ${formatTime(depMax)})`} placement="top">
          <Box
            role="slider"
            tabIndex={0}
            aria-label="Departure time"
            aria-valuemin={depMin}
            aria-valuemax={depMax}
            aria-valuenow={departureMs}
            aria-valuetext={`Leave ${formatTime(departureMs)}`}
            onPointerDown={dragPin}
            onKeyDown={(e) => (e.key === 'ArrowLeft' ? nudgePin(-1) : e.key === 'ArrowRight' ? nudgePin(1) : null)}
            sx={{ position: 'absolute', left: pct(departureMs), top: -20, transform: 'translateX(-50%)', cursor: 'ew-resize', display: 'flex', flexDirection: 'column', alignItems: 'center', '&:focus-visible': { outline: '2px solid #40E0D0', borderRadius: 1 } }}
          >
            <Box sx={{ px: 0.75, height: 16, borderRadius: 1, bgcolor: '#40E0D0', color: '#043344', fontSize: 10, fontWeight: 700, lineHeight: '16px', whiteSpace: 'nowrap' }}>Leave</Box>
            <Box sx={{ width: 2, height: 16, bgcolor: '#40E0D0' }} />
          </Box>
        </Tooltip>

        <Box
          role="slider"
          tabIndex={0}
          aria-label="Forecast time"
          aria-valuemin={0}
          aria-valuemax={48}
          aria-valuenow={Math.round(hour)}
          aria-valuetext={`Forecast ${formatTime(playMs)}`}
          onPointerDown={dragPlayhead}
          onKeyDown={(e) => (e.key === 'ArrowLeft' ? clock.set(Math.round(hour) - 1) : e.key === 'ArrowRight' ? clock.set(Math.round(hour) + 1) : null)}
          sx={{ position: 'absolute', left: pct(playMs), top: -5, width: 18, height: 18, ml: '-9px', borderRadius: '50%', bgcolor: '#E8EEF2', border: '3px solid #043344', boxShadow: '0 0 0 1px #40E0D0', cursor: 'grab', '&:focus-visible': { outline: '2px solid #40E0D0' } }}
        />

        {ticks.map((ms) => (
          <Box key={ms} sx={{ position: 'absolute', left: pct(ms), top: 14, transform: 'translateX(-50%)', fontSize: 10, color: 'text.secondary', whiteSpace: 'nowrap', pointerEvents: 'none' }}>
            {formatTime(ms)}
          </Box>
        ))}
      </Box>
      <Legend layer={layer} />
    </Paper>
  )
}

function Legend({ layer }: { layer: Layer }) {
  if (layer === 'risk') {
    return (
      <Stack direction="row" spacing={1.5} sx={{ flexWrap: 'wrap' }}>
        {RISK_LEVELS.map((r) => (
          <Stack key={r.key} direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
            <Box sx={{ width: 10, height: 10, borderRadius: '2px', bgcolor: r.color }} />
            <Typography variant="caption" color="text.secondary">
              {r.label}
            </Typography>
          </Stack>
        ))}
      </Stack>
    )
  }
  const { stops, unit } = LAYERS[layer]
  const gradient = stops.map(([v, c]) => `${c} ${(v / stops[stops.length - 1][0]) * 100}%`).join(', ')
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
      <Typography variant="caption" color="text.secondary">
        {stops[0][0]}
      </Typography>
      <Box sx={{ flex: 1, maxWidth: 280, height: 8, borderRadius: 1, background: `linear-gradient(90deg, ${gradient})`, border: 1, borderColor: 'divider' }} />
      <Typography variant="caption" color="text.secondary">
        {stops[stops.length - 1][0]}+ {unit}
      </Typography>
    </Stack>
  )
}

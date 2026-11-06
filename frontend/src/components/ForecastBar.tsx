import PauseIcon from '@mui/icons-material/Pause'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import { Box, IconButton, Paper, Slider, Stack, Switch, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from '@mui/material'
import type { Corridor } from '../api/types'
import { useForecastHour, usePlaying, type Clock } from '../lib/clock'
import { hourToTime, LAYERS, type Layer } from '../lib/forecast'
import { formatTime } from '../lib/format'
import { RISK_LEVELS } from '../lib/risk'

interface Props {
  clock: Clock
  corridor: Corridor
  departure: string
  layer: Layer
  onLayerChange: (layer: Layer) => void
  showHeatmap: boolean
  onShowHeatmapChange: (on: boolean) => void
}

const MARKS = [0, 12, 24, 36, 48].map((v) => ({ value: v, label: `+${v}h` }))

export function ForecastBar({ clock, corridor, departure, layer, onLayerChange, showHeatmap, onShowHeatmapChange }: Props) {
  const hour = useForecastHour(clock)
  const playing = usePlaying(clock)
  const departHour = (Date.parse(departure) - Date.parse(corridor.hours[0])) / 3600_000

  return (
    <Paper
      elevation={8}
      sx={{ px: 2, py: 1.25, bgcolor: 'rgba(19,26,32,0.92)', backdropFilter: 'blur(8px)', border: 1, borderColor: 'divider' }}
    >
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
        <Tooltip title={playing ? 'Pause' : 'Play the next 48 hours'}>
          <IconButton onClick={() => (playing ? clock.pause() : clock.play())} color="primary" aria-label={playing ? 'Pause forecast' : 'Play forecast'}>
            {playing ? <PauseIcon /> : <PlayArrowIcon />}
          </IconButton>
        </Tooltip>
        <Box sx={{ minWidth: 150 }}>
          <Typography variant="subtitle2" sx={{ fontVariantNumeric: 'tabular-nums' }}>
            {formatTime(hourToTime(corridor, Math.round(hour)))} · +{Math.round(hour)}h
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Heatmap and trucks at this hour
          </Typography>
        </Box>
        <Box sx={{ flex: 1 }} />
        <Switch size="small" checked={showHeatmap} onChange={(e) => onShowHeatmapChange(e.target.checked)} slotProps={{ input: { 'aria-label': 'Show heatmap' } }} />
        <ToggleButtonGroup size="small" exclusive value={layer} onChange={(_, v) => v && onLayerChange(v)} disabled={!showHeatmap} aria-label="Heatmap layer">
          {(Object.keys(LAYERS) as Layer[]).map((k) => (
            <ToggleButton key={k} value={k} sx={{ px: 1.2, py: 0.4 }}>
              {LAYERS[k].label}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </Stack>

      <Box sx={{ px: 1.5, pt: 1, position: 'relative' }}>
        {departHour > 0 && departHour <= 48 && (
          <Tooltip title="Departure">
            <Box sx={{ position: 'absolute', zIndex: 1, top: 14, left: `calc(12px + (100% - 24px) * ${departHour / 48})`, width: 3, height: 12, ml: '-1.5px', bgcolor: 'primary.light', borderRadius: 1 }} />
          </Tooltip>
        )}
        <Slider
          value={hour}
          min={0}
          max={48}
          step={0.05}
          marks={MARKS}
          onChange={(_, v) => {
            if (playing) clock.pause()
            clock.set(v as number)
          }}
          valueLabelDisplay="off"
          aria-label="Forecast hour"
          sx={{ mb: 1, '& .MuiSlider-markLabel': { fontSize: 11, color: 'text.secondary' }, '& .MuiSlider-thumb': { transition: 'none' }, '& .MuiSlider-track': { transition: 'none' } }}
        />
      </Box>
      <Legend layer={layer} />
    </Paper>
  )
}

function Legend({ layer }: { layer: Layer }) {
  if (layer === 'risk') {
    return (
      <Stack direction="row" spacing={1.5} sx={{ mt: 0.5, flexWrap: 'wrap' }}>
        {RISK_LEVELS.map((r) => (
          <Stack sx={{ alignItems: 'center' }} key={r.key} direction="row" spacing={0.5}>
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
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mt: 0.5 }}>
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

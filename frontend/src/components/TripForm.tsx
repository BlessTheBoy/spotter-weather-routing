import SwapVertIcon from '@mui/icons-material/SwapVert'
import { Box, Button, CircularProgress, IconButton, InputAdornment, Stack, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from '@mui/material'
import { useState, type FormEvent } from 'react'
import type { Place, PlanRequest } from '../api/types'
import { toLocalInput } from '../lib/format'
import { PlaceField } from './PlaceField'

const DEFAULT_ORIGIN: Place = { label: 'Denver, Colorado, US', lat: 39.7392, lng: -104.9903 }
const DEFAULT_DESTINATION: Place = { label: 'Salt Lake City, Utah, US', lat: 40.7608, lng: -111.891 }

interface Props {
  loading: boolean
  onSubmit: (req: PlanRequest) => void
}

export function TripForm({ loading, onSubmit }: Props) {
  const [origin, setOrigin] = useState<Place | null>(DEFAULT_ORIGIN)
  const [destination, setDestination] = useState<Place | null>(DEFAULT_DESTINATION)
  const [departure, setDeparture] = useState(() => toLocalInput(new Date(Date.now() + 30 * 60_000)))
  const [load, setLoad] = useState('42000')
  const [interval, setCheckpointInterval] = useState<10 | 25 | 50>(25)

  const now = new Date()
  const max = new Date(now.getTime() + 4 * 24 * 3600_000)
  const loadLb = Number(load)
  const valid = origin && destination && departure && Number.isFinite(loadLb) && loadLb >= 0 && loadLb <= 200_000

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!valid) return
    onSubmit({
      origin: origin!,
      destination: destination!,
      departure: new Date(departure).toISOString(),
      load_lb: loadLb,
      interval_mi: interval,
    })
  }

  return (
    <Box component="form" onSubmit={submit}>
      <Stack spacing={1.5}>
        <Box sx={{ position: 'relative' }}>
          <Stack spacing={1.5}>
            <PlaceField label="Origin" value={origin} onChange={setOrigin} />
            <PlaceField label="Destination" value={destination} onChange={setDestination} />
          </Stack>
          <Tooltip title="Swap origin and destination">
            <IconButton
              size="small"
              onClick={() => (setOrigin(destination), setDestination(origin))}
              sx={{ position: 'absolute', right: -6, top: '50%', transform: 'translate(100%, -50%)', display: { xs: 'none', sm: 'inline-flex' } }}
              aria-label="Swap origin and destination"
            >
              <SwapVertIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
        <Stack direction="row" spacing={1.5}>
          <TextField
            label="Departure"
            type="datetime-local"
            value={departure}
            onChange={(e) => setDeparture(e.target.value)}
            slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: toLocalInput(now), max: toLocalInput(max) } }}
          />
          <TextField
            label="Load"
            type="number"
            value={load}
            onChange={(e) => setLoad(e.target.value)}
            error={!Number.isFinite(loadLb) || loadLb < 0 || loadLb > 200_000}
            slotProps={{ input: { endAdornment: <InputAdornment position="end">lb</InputAdornment> }, htmlInput: { min: 0, max: 200000, step: 1000 } }}
            sx={{ maxWidth: 150 }}
          />
        </Stack>
        <Stack sx={{ alignItems: 'center', justifyContent: 'space-between' }} direction="row" spacing={1}>
          <Typography variant="body2" color="text.secondary">
            Checkpoint every
          </Typography>
          <ToggleButtonGroup size="small" exclusive value={interval} onChange={(_, v) => v && setCheckpointInterval(v)} aria-label="Checkpoint interval">
            {[10, 25, 50].map((v) => (
              <ToggleButton key={v} value={v} sx={{ px: 1.5 }}>
                {v} mi
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        </Stack>
        <Button type="submit" variant="contained" size="large" disabled={!valid || loading} startIcon={loading ? <CircularProgress size={18} color="inherit" /> : null}>
          {loading ? 'Checking routes and weather…' : 'Compare routes'}
        </Button>
      </Stack>
    </Box>
  )
}

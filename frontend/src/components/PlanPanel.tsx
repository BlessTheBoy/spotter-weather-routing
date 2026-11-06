import AddIcon from '@mui/icons-material/Add'
import CloseIcon from '@mui/icons-material/Close'
import FiberManualRecordIcon from '@mui/icons-material/FiberManualRecord'
import PlaceIcon from '@mui/icons-material/Place'
import RadioButtonCheckedIcon from '@mui/icons-material/RadioButtonChecked'
import SwapVertIcon from '@mui/icons-material/SwapVert'
import TuneIcon from '@mui/icons-material/Tune'
import { Alert, Box, Button, CircularProgress, IconButton, InputAdornment, Menu, MenuItem, Stack, TextField, Tooltip, Typography } from '@mui/material'
import { useState, type FormEvent } from 'react'
import { INTERVALS, type Interval, type Place } from '../api/types'
import { toLocalInput } from '../lib/format'
import { PlaceField } from './PlaceField'

export const MAX_STOPS = 3
export const MAX_DAYS_AHEAD = 7

export interface TripDraft {
  origin: Place | null
  destination: Place | null
  stops: (Place | null)[]
  departure: string // datetime-local value
  load: string
}

interface Props {
  draft: TripDraft
  onDraftChange: (d: TripDraft) => void
  interval: Interval
  onIntervalChange: (i: Interval) => void
  loading: boolean
  error: string | null
  onSubmit: () => void
}

export function draftIsValid(d: TripDraft): boolean {
  const load = Number(d.load)
  return !!d.origin && !!d.destination && !!d.departure && Number.isFinite(load) && load >= 0 && load <= 200_000 && d.stops.every(Boolean)
}

export function PlanPanel({ draft, onDraftChange, interval, onIntervalChange, loading, error, onSubmit }: Props) {
  const [menu, setMenu] = useState<HTMLElement | null>(null)
  const set = (patch: Partial<TripDraft>) => onDraftChange({ ...draft, ...patch })
  const now = new Date()
  const loadLb = Number(draft.load)
  const loadBad = !Number.isFinite(loadLb) || loadLb < 0 || loadLb > 200_000

  function submit(e: FormEvent) {
    e.preventDefault()
    if (draftIsValid(draft)) onSubmit()
  }

  return (
    <Box component="form" onSubmit={submit}>
      <Stack spacing={1.25}>
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr auto', columnGap: 0.5, alignItems: 'center' }}>
          <Stack spacing={1.25}>
            <PlaceField label="Choose starting point" value={draft.origin} onChange={(origin) => set({ origin })} allowCurrentLocation icon={<RadioButtonCheckedIcon sx={{ fontSize: 18, color: 'primary.light' }} />} />
            {draft.stops.map((stop, i) => (
              <Stack key={i} direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                <Box sx={{ flex: 1 }}>
                  <PlaceField
                    label={`Stop ${i + 1}`}
                    value={stop}
                    onChange={(p) => set({ stops: draft.stops.map((s, j) => (j === i ? p : s)) })}
                    icon={<FiberManualRecordIcon sx={{ fontSize: 14, color: '#F2C94C' }} />}
                    autoFocus={!stop}
                  />
                </Box>
                <IconButton size="small" aria-label={`Remove stop ${i + 1}`} onClick={() => set({ stops: draft.stops.filter((_, j) => j !== i) })}>
                  <CloseIcon fontSize="small" />
                </IconButton>
              </Stack>
            ))}
            <PlaceField label="Choose destination" value={draft.destination} onChange={(destination) => set({ destination })} icon={<PlaceIcon sx={{ fontSize: 18, color: '#EB5757' }} />} />
          </Stack>
          <Tooltip title="Swap start and destination">
            <IconButton aria-label="Swap start and destination" onClick={() => set({ origin: draft.destination, destination: draft.origin, stops: [...draft.stops].reverse() })}>
              <SwapVertIcon />
            </IconButton>
          </Tooltip>
        </Box>
        {draft.stops.length < MAX_STOPS && (
          <Button size="small" startIcon={<AddIcon />} onClick={() => set({ stops: [...draft.stops, null] })} sx={{ alignSelf: 'flex-start', color: 'text.secondary' }}>
            Add stop
          </Button>
        )}

        <Stack direction="row" spacing={1.25}>
          <TextField
            label="Departure"
            type="datetime-local"
            value={draft.departure}
            onChange={(e) => set({ departure: e.target.value })}
            slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: toLocalInput(now), max: toLocalInput(new Date(now.getTime() + MAX_DAYS_AHEAD * 86_400_000)) } }}
          />
          <TextField
            label="Load"
            type="number"
            value={draft.load}
            onChange={(e) => set({ load: e.target.value })}
            error={loadBad}
            slotProps={{ input: { endAdornment: <InputAdornment position="end">lb</InputAdornment> }, htmlInput: { min: 0, max: 200000, step: 1000 } }}
            sx={{ maxWidth: 160 }}
          />
        </Stack>

        <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
          <Button size="small" startIcon={<TuneIcon fontSize="small" />} onClick={(e) => setMenu(e.currentTarget)} sx={{ color: 'text.secondary', fontWeight: 500 }} aria-haspopup="menu">
            Checkpoints every {interval} mi
          </Button>
          <Menu anchorEl={menu} open={!!menu} onClose={() => setMenu(null)}>
            {INTERVALS.map((v) => (
              <MenuItem key={v} selected={v === interval} onClick={() => (onIntervalChange(v), setMenu(null))}>
                Every {v} miles
              </MenuItem>
            ))}
          </Menu>
          <Typography variant="caption" color="text.secondary">
            Up to {MAX_DAYS_AHEAD} days ahead
          </Typography>
        </Stack>

        {error && <Alert severity="error">{error}</Alert>}
        <Button type="submit" variant="contained" size="large" disabled={!draftIsValid(draft) || loading} startIcon={loading ? <CircularProgress size={18} color="inherit" /> : null}>
          {loading ? 'Checking routes and weather…' : 'Find routes'}
        </Button>
      </Stack>
    </Box>
  )
}

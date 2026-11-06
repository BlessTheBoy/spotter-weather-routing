import MyLocationIcon from '@mui/icons-material/MyLocation'
import PlaceOutlinedIcon from '@mui/icons-material/PlaceOutlined'
import { Autocomplete, Box, CircularProgress, InputAdornment, TextField } from '@mui/material'
import { useEffect, useState, type ReactNode } from 'react'
import { searchPlaces } from '../api/client'
import type { Place } from '../api/types'

const CURRENT = 'Your location'

interface Props {
  label: string
  value: Place | null
  onChange: (place: Place | null) => void
  /** Offer "Your location" (browser geolocation) as the first option. */
  allowCurrentLocation?: boolean
  icon?: ReactNode
  autoFocus?: boolean
}

type Option = Place & { current?: boolean }

function locate(): Promise<Place> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Location is not available in this browser.'))
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ label: CURRENT, lat: p.coords.latitude, lng: p.coords.longitude }),
      () => reject(new Error('Allow location access, or type a starting place.')),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    )
  })
}

export function PlaceField({ label, value, onChange, allowCurrentLocation, icon, autoFocus }: Props) {
  const [input, setInput] = useState(value?.label ?? '')
  const [options, setOptions] = useState<Place[]>([])
  const [loading, setLoading] = useState(false)
  const [locating, setLocating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => setInput(value?.label ?? ''), [value])

  useEffect(() => {
    if (input.length < 2 || input === value?.label) return
    const ctrl = new AbortController()
    // Debounce typing so we send one search per pause, not per keystroke.
    const t = setTimeout(() => {
      setLoading(true)
      searchPlaces(input, ctrl.signal)
        .then(setOptions)
        .catch(() => {})
        .finally(() => setLoading(false))
    }, 250)
    return () => {
      clearTimeout(t)
      ctrl.abort()
    }
  }, [input, value?.label])

  const shown: Option[] = allowCurrentLocation && (!input || input === value?.label) ? [{ label: CURRENT, lat: 0, lng: 0, current: true }, ...options] : options

  async function pick(o: Option | null) {
    setError(null)
    if (!o?.current) return onChange(o)
    setLocating(true)
    try {
      onChange(await locate())
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLocating(false)
    }
  }

  return (
    <Autocomplete<Option>
      value={value}
      options={shown}
      loading={loading}
      filterOptions={(x) => x}
      getOptionLabel={(o) => o.label}
      getOptionKey={(o) => (o.current ? 'current' : `${o.lat},${o.lng}`)}
      isOptionEqualToValue={(a, b) => a.label === b.label && a.lat === b.lat && a.lng === b.lng}
      onChange={(_, o) => pick(o)}
      inputValue={input}
      onInputChange={(_, v) => setInput(v)}
      noOptionsText={input.length < 2 ? 'Type a city or address' : 'No matches'}
      renderOption={({ key, ...p }, o) => (
        <Box component="li" key={key} {...p} sx={{ gap: 1.25 }}>
          {o.current ? <MyLocationIcon fontSize="small" color="primary" /> : <PlaceOutlinedIcon fontSize="small" sx={{ color: 'text.secondary' }} />}
          {o.label}
        </Box>
      )}
      renderInput={(params) => (
        <TextField
          {...params}
          placeholder={label}
          autoFocus={autoFocus}
          error={!!error}
          helperText={error}
          slotProps={{
            ...params.slotProps,
            input: {
              ...params.slotProps.input,
              startAdornment: <InputAdornment position="start">{locating ? <CircularProgress size={16} /> : icon}</InputAdornment>,
            },
            htmlInput: { ...params.slotProps.htmlInput, 'aria-label': label },
          }}
        />
      )}
    />
  )
}

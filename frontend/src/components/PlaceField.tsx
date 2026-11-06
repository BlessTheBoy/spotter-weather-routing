import { Autocomplete, TextField } from '@mui/material'
import { useEffect, useState } from 'react'
import { searchPlaces } from '../api/client'
import type { Place } from '../api/types'

interface Props {
  label: string
  value: Place | null
  onChange: (place: Place | null) => void
}

export function PlaceField({ label, value, onChange }: Props) {
  const [input, setInput] = useState(value?.label ?? '')
  const [options, setOptions] = useState<Place[]>([])
  const [loading, setLoading] = useState(false)

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

  return (
    <Autocomplete
      value={value}
      options={options}
      loading={loading}
      filterOptions={(x) => x}
      getOptionLabel={(o) => o.label}
      getOptionKey={(o) => `${o.lat},${o.lng}`}
      isOptionEqualToValue={(a, b) => a.lat === b.lat && a.lng === b.lng}
      onChange={(_, place) => onChange(place)}
      inputValue={input}
      onInputChange={(_, v) => setInput(v)}
      noOptionsText={input.length < 2 ? 'Type a city or address' : 'No matches'}
      renderInput={(params) => <TextField {...params} label={label} />}
    />
  )
}

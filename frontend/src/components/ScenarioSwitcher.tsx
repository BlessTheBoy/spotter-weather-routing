import ScienceIcon from '@mui/icons-material/Science'
import { Button, ListItemText, Menu, MenuItem } from '@mui/material'
import { useState } from 'react'
import { getScenario, setScenario } from '../mocks/mockApi'
import { SCENARIOS, type ScenarioId } from '../mocks/scenarios'

/** Mock mode only: pick the synthetic weather to replay, then re-plan. */
export function ScenarioSwitcher({ onChange }: { onChange: () => void }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [current, setCurrent] = useState<ScenarioId>(getScenario())
  const label = SCENARIOS.find((s) => s.id === current)?.label
  return (
    <>
      <Button size="small" variant="outlined" startIcon={<ScienceIcon fontSize="small" />} onClick={(e) => setAnchor(e.currentTarget)} sx={{ bgcolor: 'rgba(19,26,32,0.92)', color: '#F2C94C', borderColor: 'rgba(242,201,76,0.4)' }}>
        Mock: {label}
      </Button>
      <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}>
        {SCENARIOS.map((s) => (
          <MenuItem
            key={s.id}
            selected={s.id === current}
            onClick={() => {
              setScenario(s.id)
              setCurrent(s.id)
              setAnchor(null)
              onChange()
            }}
          >
            <ListItemText primary={s.label} secondary={s.hint} />
          </MenuItem>
        ))}
      </Menu>
    </>
  )
}

import { CheckIcon, ChevronDownIcon } from 'lucide-react'
import { useState } from 'react'
import { Command, CommandGroup, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { getScenario, setScenario } from '@/mocks/mockApi'
import { SCENARIOS, type ScenarioId } from '@/mocks/scenarios'

/** Demo data only: the app's one demo marker, and the menu of weather to replay (re-plans on pick). */
const label = (id: ScenarioId) => SCENARIOS.find((s) => s.id === id)!.label.replace(' (default)', '')

export function ScenarioSwitcher({ onChange }: { onChange: () => void }) {
  const [open, setOpen] = useState(false)
  const [current, setCurrent] = useState<ScenarioId>(getScenario())
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex shrink-0 items-center gap-1 rounded-full bg-risk-moderate/15 py-1 pr-1.5 pl-2.5 text-xs font-semibold whitespace-nowrap text-risk-moderate outline-none hover:bg-risk-moderate/25 focus-visible:ring-3 focus-visible:ring-ring/50"
          aria-label={`Demo data, weather: ${label(current)}. Change`}
        >
          Demo · {label(current)}
          <ChevronDownIcon className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="end">
        <Command>
          <CommandList>
            <CommandGroup heading="Weather scenario">
              {SCENARIOS.map((s) => (
                <CommandItem
                  key={s.id}
                  value={s.id}
                  onSelect={() => {
                    setScenario(s.id)
                    setCurrent(s.id)
                    setOpen(false)
                    onChange()
                  }}
                  className="items-start"
                >
                  <div className="flex flex-col">
                    <span>{label(s.id)}</span>
                    <span className="text-xs text-muted-foreground">{s.hint}</span>
                  </div>
                  {s.id === current && <CheckIcon className="ml-auto" />}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

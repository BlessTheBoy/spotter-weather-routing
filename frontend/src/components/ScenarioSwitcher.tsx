import { CheckIcon, FlaskConicalIcon } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Command, CommandGroup, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { getScenario, setScenario } from '@/mocks/mockApi'
import { SCENARIOS, type ScenarioId } from '@/mocks/scenarios'

/** Mock mode only: pick the synthetic weather to replay, then re-plan. */
export function ScenarioSwitcher({ onChange }: { onChange: () => void }) {
  const [open, setOpen] = useState(false)
  const [current, setCurrent] = useState<ScenarioId>(getScenario())
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" className="border-risk-moderate/40 bg-popover/90 text-risk-moderate">
          <FlaskConicalIcon data-icon="inline-start" />
          Mock: {SCENARIOS.find((s) => s.id === current)?.label}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
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
                    <span>{s.label}</span>
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

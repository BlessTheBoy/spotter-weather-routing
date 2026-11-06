import { CheckIcon, type LucideIcon } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Command, CommandGroup, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

interface Props<T extends string | number> {
  icon: LucideIcon
  label: string
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
}

/** A quiet text button that opens a short list: for settings that shouldn't look like a form field. */
export function DropdownLike<T extends string | number>({ icon: Icon, label, options, value, onChange }: Props<T>) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="self-start text-muted-foreground" aria-haspopup="listbox">
          <Icon data-icon="inline-start" />
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-48 p-0" align="start">
        <Command>
          <CommandList>
            <CommandGroup>
              {options.map((o) => (
                <CommandItem key={o.value} value={String(o.value)} onSelect={() => (onChange(o.value), setOpen(false))}>
                  {o.label}
                  {o.value === value && <CheckIcon className="ml-auto" />}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

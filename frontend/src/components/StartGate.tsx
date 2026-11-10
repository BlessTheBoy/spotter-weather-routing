import { FlaskConicalIcon, RadioTowerIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import type { DataMode } from '@/lib/dataMode'
import { cn } from '@/lib/utils'

interface Props {
  /** The choice being prepared, while the app finishes loading behind the gate. */
  pending: DataMode | null
  onChoose: (m: DataMode) => void
}

/**
 * Shown on every load, over a blurred view of the app. Picking a mode can't
 * finish until the app behind has loaded, so the gate never lifts onto a
 * half-drawn screen.
 */
export function StartGate({ pending, onChoose }: Props) {
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="gate-title" className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-background/45 p-4 backdrop-blur-md">
      <div className="flex w-full max-w-2xl flex-col gap-5 rounded-3xl border bg-popover/95 p-5 shadow-2xl sm:p-7">
        <div className="flex items-center gap-3">
          <img src="/favicon.svg" alt="" className="size-10" />
          <div>
            <h1 id="gate-title" className="text-lg leading-tight font-semibold">
              Weather-Aware Truck Routing
            </h1>
            <p className="text-sm text-muted-foreground">Three truck routes, weather at your ETA, ranked by risk.</p>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Choice
            icon={<FlaskConicalIcon className="text-risk-moderate" />}
            title="Explore with demo data"
            tag="Recommended"
            line="Every risk level and a simulated drive. Instant."
            action="Start demo"
            primary
            busy={pending === 'demo'}
            disabled={pending !== null}
            onClick={() => onChoose('demo')}
          />
          <Choice
            icon={<RadioTowerIcon className="text-primary" />}
            title="Use live data"
            line="Real TomTom truck routes and live forecasts. US and Canada."
            action="Start live"
            busy={pending === 'live'}
            disabled={pending !== null}
            onClick={() => onChoose('live')}
          />
        </div>

        <p className="text-xs text-muted-foreground">Refresh the page any time to switch.</p>
      </div>
    </div>
  )
}

function Choice(props: { icon: ReactNode; title: string; tag?: string; line: string; action: string; primary?: boolean; busy: boolean; disabled: boolean; onClick: () => void }) {
  const { icon, title, tag, line, action, primary, busy, disabled, onClick } = props
  return (
    <div className={cn('flex flex-col gap-3 rounded-2xl border p-4', primary ? 'border-primary/50 bg-primary/5' : 'bg-card')}>
      <div className="flex items-center gap-2">
        {icon}
        <p className="font-semibold">{title}</p>
        {tag && <span className="ml-auto rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">{tag}</span>}
      </div>
      <p className="flex-1 text-sm text-muted-foreground">{line}</p>
      <Button size="lg" className="h-11" variant={primary ? 'default' : 'outline'} disabled={disabled} onClick={onClick} autoFocus={primary}>
        {busy && <Spinner data-icon="inline-start" />}
        {busy ? 'Getting the map ready…' : action}
      </Button>
    </div>
  )
}

import type { UpdateState } from '@shared/types'
import { cn } from 'cn'
import { CircleAlert, CircleArrowUp, LoaderCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'

function describe({ status, version, percent, autoUpdate }: UpdateState): string {
  switch (status) {
    case 'checking':
      return 'Checking for updates…'
    case 'available':
      return `NetSetGo ${version} is available`
    case 'downloading':
      return `Downloading NetSetGo ${version}… ${percent}%`
    case 'ready':
      return `NetSetGo ${version} is ready — restart to update`
    case 'error':
      return `Couldn’t install NetSetGo ${version}`
    case 'website':
      return `NetSetGo ${version} is available on the website`
    default:
      return autoUpdate ? 'NetSetGo updates automatically' : 'Automatic updates are off'
  }
}

/** Where the app's own update is, at a glance. Clicking opens the update menu (see
 * main/updater.ts) — natively, so it's the same menu as the macOS app menu's. */
export function UpdateIndicator(): React.JSX.Element {
  const [update, setUpdate] = useState<UpdateState>({ status: 'idle', autoUpdate: true })

  useEffect(() => {
    const stop = window.netsetgo.onUpdateState(setUpdate)
    window.netsetgo.updateState().then(setUpdate, () => {})
    return stop
  }, [])

  const { status, percent } = update
  const label = describe(update)
  const text =
    status === 'downloading'
      ? `${percent}%`
      : status === 'ready'
        ? 'Restart to update'
        : status === 'available' || status === 'website'
          ? 'Update'
          : null
  const busy = status === 'checking' || status === 'downloading'
  const Icon = busy ? LoaderCircle : status === 'error' ? CircleAlert : CircleArrowUp

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={label}
            onClick={() => void window.netsetgo.showUpdateMenu()}
            className={cn(
              'flex h-[26px] min-w-[26px] shrink-0 cursor-default items-center justify-center gap-1.5 rounded-[6px] border-[0.5px] border-border bg-secondary px-[5px] [-webkit-app-region:no-drag]',
              status === 'available' || status === 'ready' || status === 'website'
                ? 'text-primary'
                : 'text-[var(--text-secondary)]'
            )}
          >
            <Icon size={15} strokeWidth={1.3} className={busy ? 'animate-spin' : undefined} />
            {text && <span className="tabular-nums">{text}</span>}
          </button>
        }
      />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

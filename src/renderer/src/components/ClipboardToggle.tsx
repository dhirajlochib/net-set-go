import { ClipboardCheck, ClipboardList } from 'lucide-react'
import { useAppStore } from '../store/useAppStore'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'

/** Turns on offering download links copied anywhere (see main/clipboardWatcher.ts). */
export function ClipboardToggle(): React.JSX.Element {
  const on = useAppStore((store) => store.watchClipboard)
  const setOn = useAppStore((store) => store.setWatchClipboard)
  const label = on ? 'Stop offering links you copy' : 'Offer to download links you copy'
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label="Offer links you copy"
            aria-pressed={on}
            onClick={() => setOn(!on)}
            className={`flex size-[26px] shrink-0 cursor-default items-center justify-center rounded-[6px] border-[0.5px] [-webkit-app-region:no-drag] ${
              on
                ? 'border-transparent bg-primary text-primary-foreground'
                : 'border-border bg-secondary text-[var(--text-secondary)]'
            }`}
          >
            {on ? (
              <ClipboardCheck className="size-[15px]" strokeWidth={1.6} />
            ) : (
              <ClipboardList className="size-[15px]" strokeWidth={1.6} />
            )}
          </button>
        }
      />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

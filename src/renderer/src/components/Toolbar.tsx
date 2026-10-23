import { cn } from 'cn'
import { TOOLBAR_HEIGHT } from '../theme'

const isMac = window.netsetgo.platform === 'darwin'

/** The top of every screen, doubling as the window's title bar, as in a macOS unified toolbar:
 * the window is dragged by its empty space, and the OS's own controls sit over it (see
 * main/index.ts) — the traffic lights at its left on macOS, minimize/maximize/close at its
 * right on Windows and Linux — so it leaves room for them on that side. */
export function Toolbar({
  className,
  style,
  ...props
}: React.ComponentProps<'div'>): React.JSX.Element {
  return (
    <div
      {...props}
      style={{ height: TOOLBAR_HEIGHT, ...style }}
      className={cn(
        'app-toolbar flex shrink-0 items-center gap-3 border-b-[0.5px] border-border bg-background px-5',
        isMac ? 'pl-[84px]' : 'pr-[148px]',
        className
      )}
    />
  )
}

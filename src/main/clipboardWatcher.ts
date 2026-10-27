import { clipboard, Notification } from 'electron'
import { downloadableLink, safeDecode } from '../shared/clipboardLinks'

// Copy a download link anywhere and NetSetGo offers it: opt-in, since it reads the clipboard
// every second. Nothing tells a process the clipboard changed, so it looks.

const POLL_MS = 1000

/** The file a link names, for the notification: its last path segment, or "a magnet link". */
function describe(link: string): string {
  if (/^magnet:/i.test(link)) {
    const name = new URLSearchParams(link.slice(link.indexOf('?') + 1)).get('dn')
    return name ?? 'this magnet link'
  }
  return safeDecode(new URL(link).pathname.split('/').pop() ?? link)
}

export interface ClipboardWatcherHooks {
  /** Whether NetSetGo's own window has focus: a link copied there is the user working in the
   * app (copying a download's link), not one to offer back to them. */
  appFocused: () => boolean
  /** Queues the link for New download without taking focus. */
  queue: (link: string) => void
  /** Brings the window forward to it. */
  show: () => void
}

export class ClipboardWatcher {
  private timer: NodeJS.Timeout | null = null
  /** What the clipboard held at the last look, so only a change is offered. */
  private last: string | null = null
  private notification: Notification | null = null

  constructor(private readonly hooks: ClipboardWatcherHooks) {}

  /** Starts or stops watching. Turning it on never offers what's already on the clipboard. */
  async setEnabled(enabled: boolean): Promise<void> {
    if (enabled === (this.timer !== null)) return
    if (!enabled) {
      clearInterval(this.timer!)
      this.timer = null
      this.last = null
      return
    }
    this.timer = setInterval(() => void this.look(), POLL_MS)
    this.timer.unref()
    this.last = await clipboard.readText().catch(() => '')
  }

  private async look(): Promise<void> {
    // Set before the first look finishes: nothing to compare against yet.
    if (this.last === null) return
    const text = await clipboard.readText().catch(() => this.last ?? '')
    if (text === this.last) return
    this.last = text
    if (this.hooks.appFocused()) return
    const link = downloadableLink(text)
    if (!link) return
    this.hooks.queue(link)
    this.notify(link)
  }

  private notify(link: string): void {
    if (!Notification.isSupported()) return
    this.notification?.close()
    this.notification = new Notification({
      title: 'Download with NetSetGo?',
      body: describe(link),
      silent: true
    })
    this.notification.on('click', () => this.hooks.show())
    this.notification.show()
  }
}

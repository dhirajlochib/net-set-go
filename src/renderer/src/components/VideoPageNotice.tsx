import { Clapperboard } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from './ui/button'

const INSTALL =
  window.netsetgo.platform === 'darwin'
    ? 'brew install yt-dlp'
    : window.netsetgo.platform === 'win32'
      ? 'winget install yt-dlp'
      : 'pipx install yt-dlp'

/** Shown when a link turns out to be a web page rather than a file: the video on it can be
 * downloaded through yt-dlp (see main/media.ts), which then opens here as its own link. */
export function VideoPageNotice({ pageUrl }: { pageUrl: string }): React.JSX.Element {
  const [available, setAvailable] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let current = true
    void window.netsetgo.ytDlpAvailable().then(
      (found) => current && setAvailable(found),
      () => current && setAvailable(false)
    )
    return () => {
      current = false
    }
  }, [])

  const find = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    const why = await window.netsetgo.downloadMedia(pageUrl).catch((e: Error) => e.message)
    setBusy(false)
    if (why !== null) setError(why)
  }

  return (
    <div className="flex flex-col gap-2 rounded-[10px] border-[0.5px] border-border bg-card px-3 py-2.5 text-[12.5px]">
      <div className="flex items-center gap-3">
        <Clapperboard aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          This link is a web page, not a file.
          {available === false && (
            <>
              {' '}
              To download a video on it, install yt-dlp:{' '}
              <code className="rounded bg-foreground/5 px-1 font-mono text-[11.5px] whitespace-nowrap">
                {INSTALL}
              </code>
            </>
          )}
        </span>
        {available && (
          <Button type="button" size="sm" disabled={busy} onClick={() => void find()}>
            {busy ? 'Finding the video…' : 'Download its video'}
          </Button>
        )}
      </div>
      {error && <div className="text-[var(--color-danger)]">{error}</div>}
    </div>
  )
}

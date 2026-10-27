import { execFile } from 'node:child_process'
import { access, constants } from 'node:fs/promises'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import { promisify } from 'node:util'
import type { BrowserContext } from '../shared/types'
import { testKnobs } from './testKnobs'

// Videos on web pages (YouTube, Vimeo, news sites…), through yt-dlp if it's installed. NetSetGo
// doesn't ship it: it's looked for where installers put it. yt-dlp only finds the video's direct
// address and the headers the site wants; NetSetGo downloads it like any other file, over the
// networks picked.

const run = promisify(execFile)

const NAMES = process.platform === 'win32' ? ['yt-dlp.exe'] : ['yt-dlp']

/** Where installers put it beyond PATH, which an app opened from the Dock or Finder doesn't get
 * a shell's version of. */
function extraDirs(): string[] {
  const home = homedir()
  if (process.platform === 'darwin')
    return ['/opt/homebrew/bin', '/usr/local/bin', join(home, '.local/bin')]
  if (process.platform === 'win32') {
    const local = process.env['LOCALAPPDATA'] ?? join(home, 'AppData', 'Local')
    return [join(local, 'Microsoft', 'WinGet', 'Links'), join(home, 'scoop', 'shims')]
  }
  return ['/usr/local/bin', '/usr/bin', join(home, '.local/bin'), '/snap/bin']
}

/** The yt-dlp to run, or null when there's none. */
export async function findYtDlp(): Promise<string | null> {
  if (testKnobs.ytDlpPath !== undefined) return testKnobs.ytDlpPath || null
  const dirs = [...(process.env['PATH'] ?? '').split(delimiter).filter(Boolean), ...extraDirs()]
  for (const dir of dirs) {
    for (const name of NAMES) {
      const candidate = join(dir, name)
      try {
        await access(candidate, constants.X_OK)
        return candidate
      } catch {
        // Not here.
      }
    }
  }
  return null
}

export interface MediaInfo {
  /** The video's direct address: a file the download engine fetches like any other. */
  url: string
  fileName: string
  /** Headers the site wants with it, as the browser extension would hand them over. */
  browser: BrowserContext
  /** The site, as yt-dlp names it ("Youtube", "Vimeo"). */
  site: string
}

/** Characters no file system takes in a name. */
function safeName(name: string): string {
  const cleaned = [...name]
    .map((char) => (char.charCodeAt(0) < 0x20 || '<>:"/\\|?*'.includes(char) ? ' ' : char))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned.slice(0, 180) || 'video'
}

/**
 * The video on the page at `pageUrl`, in the best quality that comes as one file (video and audio
 * together), so nothing has to be merged afterwards. Rejects with what went wrong, in words.
 */
export async function resolveMedia(pageUrl: string): Promise<MediaInfo> {
  if (!/^https?:\/\//i.test(pageUrl))
    throw new Error('Only web page links can be checked for videos.')
  const ytDlp = await findYtDlp()
  if (!ytDlp) throw new Error('yt-dlp isn’t installed.')
  let stdout: string
  try {
    ;({ stdout } = await run(
      ytDlp,
      [
        '-J',
        '--no-playlist',
        '--no-warnings',
        '-f',
        'b[protocol^=http][ext=mp4]/b[protocol^=http]',
        '--',
        pageUrl
      ],
      { timeout: 90_000, maxBuffer: 64 * 1024 * 1024, windowsHide: true }
    ))
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr ?? ''
    const reason = /ERROR:\s*(.+)/.exec(stderr)?.[1]?.trim()
    throw new Error(reason ? `yt-dlp: ${reason}` : 'yt-dlp couldn’t read this page.')
  }
  let info: Record<string, unknown>
  try {
    info = JSON.parse(stdout) as Record<string, unknown>
  } catch {
    throw new Error('yt-dlp gave an answer NetSetGo couldn’t read.')
  }
  const url = typeof info.url === 'string' ? info.url : null
  if (!url || !/^https?:\/\//i.test(url)) {
    throw new Error('This video only comes as a stream, not as a file NetSetGo can download.')
  }
  const headers = (info.http_headers ?? {}) as Record<string, unknown>
  const userAgent = typeof headers['User-Agent'] === 'string' ? headers['User-Agent'] : undefined
  const referer =
    typeof headers['Referer'] === 'string' && /^https?:\/\//i.test(headers['Referer'])
      ? headers['Referer']
      : undefined
  const title = typeof info.title === 'string' ? info.title : 'video'
  const ext = typeof info.ext === 'string' && /^\w{1,8}$/.test(info.ext) ? info.ext : 'mp4'
  const site =
    typeof info.extractor_key === 'string' ? info.extractor_key : new URL(pageUrl).hostname
  return {
    url,
    fileName: `${safeName(title)}.${ext}`,
    browser: { cookies: [], referer, userAgent },
    site
  }
}

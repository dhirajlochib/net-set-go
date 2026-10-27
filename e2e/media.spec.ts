import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BLOCK, expect, test } from './fixtures'

// Videos on web pages through yt-dlp (main/media.ts). A real yt-dlp would reach real sites; this
// one is a script that answers as yt-dlp does, from a JSON file each test writes next to it.

const FAKE_DIR = mkdtempSync(join(tmpdir(), 'netsetgo-fake-ytdlp-'))
const FAKE = join(FAKE_DIR, 'yt-dlp')
const ANSWER = join(FAKE_DIR, 'answer.json')
writeFileSync(
  FAKE,
  `#!/usr/bin/env node
const { readFileSync } = require('node:fs')
const answer = JSON.parse(readFileSync(${JSON.stringify(ANSWER)}, 'utf8'))
if (answer.error) { process.stderr.write('ERROR: ' + answer.error + '\\n'); process.exit(1) }
process.stdout.write(JSON.stringify(answer))
`
)
chmodSync(FAKE, 0o755)

const answer = (value: object): Promise<void> => writeFile(ANSWER, JSON.stringify(value))

test.describe('videos on web pages', () => {
  test.skip(process.platform === 'win32', 'the stand-in yt-dlp is a script with a shebang')
  test.use({ appEnv: { NETSETGO_E2E_YTDLP: FAKE } })

  test('the video yt-dlp finds is offered as a file and downloaded with its headers @smoke', async ({
    netsetgo,
    serve,
    dirs
  }) => {
    // Started from the window, it goes where the window saves to: the test's folder.
    await netsetgo.api.updateSettings({ destinationDir: dirs.dest })
    await netsetgo.relaunch()
    const origin = await serve({ size: 32 * BLOCK })
    await answer({
      title: 'Big: Buck/Bunny?',
      ext: 'mp4',
      url: origin.url(),
      extractor_key: 'Vimeo',
      http_headers: { 'User-Agent': 'FakeTube/1.0', Referer: 'https://vimeo.com/123' }
    })
    expect(await netsetgo.api.ytDlpAvailable()).toBe(true)
    expect(await netsetgo.api.downloadMedia('https://vimeo.com/123')).toBeNull()
    const [link] = await netsetgo.api.pendingLinks()
    expect(link.from).toBe('Vimeo via yt-dlp')
    expect(link.probe?.kind === 'http' && link.probe.suggestedFileName).toBe('Big Buck Bunny.mp4')

    const page = netsetgo.page
    await expect(page.getByText('From Vimeo via yt-dlp')).toBeVisible()
    await netsetgo.expectNextDownload(origin.sha256)
    await page.getByRole('button', { name: 'Download', exact: true }).click()
    await netsetgo.waitForHttpStatus('completed')
    const chunks = origin.chunkRequests()
    expect(chunks.length).toBeGreaterThan(0)
    expect(chunks.every((request) => request.userAgent === 'FakeTube/1.0')).toBe(true)
    expect(chunks.every((request) => request.referer === 'https://vimeo.com/123')).toBe(true)
  })

  test('what yt-dlp says went wrong is shown, and a stream-only video is refused', async ({
    netsetgo
  }) => {
    await answer({ error: 'Unsupported URL: https://example.com/' })
    expect(await netsetgo.api.downloadMedia('https://example.com/')).toBe(
      'yt-dlp: Unsupported URL: https://example.com/'
    )
    await answer({ title: 'Live', ext: 'mp4', url: 'rtmp://example.com/live' })
    expect(await netsetgo.api.downloadMedia('https://example.com/live')).toMatch(
      /only comes as a stream/
    )
    expect(await netsetgo.api.pendingLinks()).toEqual([])
  })
})

test.describe('without yt-dlp', () => {
  test.use({ appEnv: { NETSETGO_E2E_YTDLP: '' } })
  test('it says so instead of trying', async ({ netsetgo }) => {
    expect(await netsetgo.api.ytDlpAvailable()).toBe(false)
    expect(await netsetgo.api.downloadMedia('https://example.com/watch')).toMatch(/isn’t installed/)
  })
})

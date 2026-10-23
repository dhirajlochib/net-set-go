import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { PROJECT_ROOT, test } from './fixtures'

// Not a test: captures each main screen in light and dark for design review. Skipped unless
// NETSETGO_SCREENS=1 (npm run screens). Images land in screens/<label>/.

const OUT = join(PROJECT_ROOT, 'screens', process.env.NETSETGO_SCREENS_LABEL || 'current')

test.skip(process.env.NETSETGO_SCREENS !== '1', 'run with npm run screens')
test.use({ appEnv: { NETSETGO_E2E_HIDE_WINDOW: '0' } })

for (const theme of ['light', 'dark'] as const) {
  test(`screens (${theme})`, async ({ netsetgo, serve }) => {
    await mkdir(OUT, { recursive: true })
    const page = netsetgo.page
    await netsetgo.api.updateSettings({ themeSource: theme })
    await page.emulateMedia({ colorScheme: theme })
    await page.setViewportSize({ width: 960, height: 640 })
    const shot = (name: string): Promise<Buffer> =>
      page.screenshot({ path: join(OUT, `${theme}-${name}.png`) })

    await page.waitForTimeout(400)
    await shot('1-empty')

    await netsetgo.newDownload()
    await page.waitForTimeout(300)
    await shot('2-new-download')
    await page.keyboard.press('Escape')

    const origin = await serve({ size: 64 * 1024 * 1024, bytesPerSecond: 3 * 1024 * 1024 })
    const id = await netsetgo.start(origin.url(), origin.sha256, { fileName: 'ubuntu-24.04.iso' })
    await page.waitForTimeout(2500)
    await shot('3-list')

    await page.getByText('ubuntu-24.04.iso').first().click()
    await page.waitForTimeout(1500)
    await shot('4-downloading')
    await netsetgo.api.pauseDownload(id)
  })
}

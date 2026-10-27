import { createServer, Socket, type Server } from 'node:net'
import { BLOCK, expect, expectHttp, test } from './fixtures'

// A phone or laptop added as a network (main/network/proxy.ts): connections to the server are
// tunnelled through its HTTP proxy with CONNECT. This stands in for the device: a CONNECT-only
// proxy on this computer that counts the tunnels it opens.

class FakeProxy {
  tunnels = 0
  readonly targets: string[] = []
  private server!: Server
  port = 0

  /** `refuse`: answers every CONNECT with 403, like a proxy that won't open the tunnel. */
  async start(refuse = false): Promise<this> {
    this.server = createServer((client) => {
      let head = Buffer.alloc(0)
      const onData = (chunk: Buffer): void => {
        head = Buffer.concat([head, chunk])
        const end = head.indexOf('\r\n\r\n')
        if (end < 0) return
        client.off('data', onData)
        const [method, target] = head.subarray(0, head.indexOf('\r\n')).toString().split(' ')
        if (method !== 'CONNECT' || refuse) {
          client.end('HTTP/1.1 403 Forbidden\r\n\r\n')
          return
        }
        this.targets.push(target)
        const [host, port] = [
          target.slice(0, target.lastIndexOf(':')),
          target.slice(target.lastIndexOf(':') + 1)
        ]
        const upstream = new Socket()
        upstream.connect(Number(port), host, () => {
          this.tunnels += 1
          client.write('HTTP/1.1 200 Connection established\r\n\r\n')
          const rest = head.subarray(end + 4)
          if (rest.length) upstream.write(rest)
          client.pipe(upstream).pipe(client)
        })
        upstream.on('error', () => client.destroy())
        client.on('error', () => upstream.destroy())
      }
      client.on('data', onData)
    })
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve))
    this.port = (this.server.address() as { port: number }).port
    return this
  }

  close(): Promise<void> {
    return new Promise((resolve) => this.server.close(() => resolve()))
  }
}

const PROXY_ID = 'proxy:phone'

test.describe('a phone or laptop as a network', () => {
  test('a download goes through the device alongside this computer’s network @smoke', async ({
    netsetgo,
    serve
  }) => {
    const proxy = await new FakeProxy().start()
    try {
      await netsetgo.api.updateSettings({
        proxyNetworks: [{ id: 'phone', name: 'My phone', host: '127.0.0.1', port: proxy.port }]
      })
      await expect
        .poll(async () => (await netsetgo.api.listInterfaces()).map((iface) => iface.id))
        .toContain(PROXY_ID)
      const listed = (await netsetgo.api.listInterfaces()).find((iface) => iface.id === PROXY_ID)!
      expect(listed).toMatchObject({ kind: 'proxy', displayName: 'My phone' })

      const origin = await serve({ size: 48 * BLOCK })
      await netsetgo.start(origin.url(), origin.sha256, { networks: ['a', PROXY_ID] })
      const done = expectHttp(await netsetgo.waitForHttpStatus('completed'))
      const viaPhone = done.networks.find((network) => network.id === PROXY_ID)!
      expect(viaPhone.bytesDownloaded).toBeGreaterThan(0)
      expect(proxy.tunnels).toBeGreaterThan(0)
      expect(proxy.targets[0]).toBe(new URL(origin.url()).host)
    } finally {
      await proxy.close()
    }
  })

  test('a device that refuses the tunnel leaves the download to the others', async ({
    netsetgo,
    serve
  }) => {
    const proxy = await new FakeProxy().start(true)
    try {
      await netsetgo.api.updateSettings({
        proxyNetworks: [{ id: 'phone', name: 'My phone', host: '127.0.0.1', port: proxy.port }]
      })
      await expect
        .poll(async () => (await netsetgo.api.listInterfaces()).map((iface) => iface.id))
        .toContain(PROXY_ID)
      const origin = await serve({ size: 24 * BLOCK })
      await netsetgo.start(origin.url(), origin.sha256, { networks: ['a', PROXY_ID] })
      const done = expectHttp(await netsetgo.waitForHttpStatus('completed'))
      expect(done.networks.find((network) => network.id === PROXY_ID)?.bytesDownloaded ?? 0).toBe(0)
      expect(await netsetgo.api.testProxy('127.0.0.1', proxy.port)).toMatch(/refused/)
    } finally {
      await proxy.close()
    }
  })

  test('saved devices are checked, and removing one removes its network', async ({ netsetgo }) => {
    await netsetgo.api.updateSettings({
      proxyNetworks: [
        { id: 'phone', name: 'My phone', host: '192.168.1.20', port: 8080 },
        { id: 'bad', name: 'Bad', host: 'a host with spaces', port: 8080 },
        { id: 'port', name: 'Port', host: '10.0.0.2', port: 70000 }
      ]
    })
    await expect
      .poll(async () =>
        (await netsetgo.api.listInterfaces())
          .filter((iface) => iface.kind === 'proxy')
          .map((iface) => iface.id)
      )
      .toEqual([PROXY_ID])
    await netsetgo.relaunch()
    await expect
      .poll(async () => (await netsetgo.api.listInterfaces()).map((iface) => iface.id))
      .toContain(PROXY_ID)
    await netsetgo.api.updateSettings({ proxyNetworks: [] })
    await expect
      .poll(async () => (await netsetgo.api.listInterfaces()).map((iface) => iface.id))
      .not.toContain(PROXY_ID)
  })

  test('added, tested and removed from the networks menu', async ({ netsetgo }) => {
    const proxy = await new FakeProxy().start(true)
    try {
      const page = netsetgo.page
      await page
        .getByRole('button', { name: /networks?/ })
        .first()
        .click()
      await page.getByRole('button', { name: 'Add a phone or laptop' }).click()
      const dialog = page.getByRole('dialog', { name: 'Add a phone or laptop' })
      await dialog.getByLabel('Name').fill('Spare laptop')
      // Pasted whole, the port is split off when the field is left.
      await dialog.getByLabel('Address').fill(`127.0.0.1:${proxy.port}`)
      await dialog.getByLabel('Port').click()
      await expect(dialog.getByLabel('Address')).toHaveValue('127.0.0.1')
      await expect(dialog.getByLabel('Port')).toHaveValue(String(proxy.port))
      await dialog.getByRole('button', { name: 'Test connection' }).click()
      await expect(dialog.getByRole('status')).toContainText('refused')
      await dialog.getByRole('button', { name: 'Add' }).click()
      await expect(dialog).toBeHidden()

      await expect
        .poll(
          async () =>
            (await netsetgo.api.listInterfaces()).filter((iface) => iface.kind === 'proxy').length
        )
        .toBe(1)
      await page
        .getByRole('button', { name: /networks?/ })
        .first()
        .click()
      await page.getByRole('button', { name: 'Remove Spare laptop' }).click()
      await expect
        .poll(
          async () =>
            (await netsetgo.api.listInterfaces()).filter((iface) => iface.kind === 'proxy').length
        )
        .toBe(0)
    } finally {
      await proxy.close()
    }
  })
})

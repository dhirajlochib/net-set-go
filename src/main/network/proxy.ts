import { connect, isIP, type Socket } from 'node:net'
import type { NetworkInterfaceInfo, ProxyNetwork } from '../../shared/types'

// A phone or laptop running an HTTP proxy, used as one more network: a connection to the server
// is a tunnel through the device (HTTP CONNECT), so the device looks the server up and fetches
// from it over its own internet. That's what adds a line the computer can't join itself, like a
// second Wi-Fi network the phone is on.

/** Ids of these networks start with this, so they never clash with a device's name. */
export const PROXY_ID_PREFIX = 'proxy:'

/** How a saved device appears among the computer's networks. */
export function proxyInterface(proxy: ProxyNetwork): NetworkInterfaceInfo {
  return {
    id: `${PROXY_ID_PREFIX}${proxy.id}`,
    device: `${proxy.host}:${proxy.port}`,
    displayName: proxy.name,
    addresses: [],
    kind: 'proxy',
    proxy: { host: proxy.host, port: proxy.port }
  }
}

const abortError = (): DOMException => new DOMException('Aborted', 'AbortError')

/** The longest reply to CONNECT read before giving up on it as not a proxy. */
const MAX_REPLY_BYTES = 16 * 1024

/**
 * A socket to `host:port` through the proxy at `proxy`, wrapped in TLS by `secure` once the
 * tunnel is open. Fails if the device can't be reached, refuses the tunnel, or takes longer than
 * `timeoutMs` for all of it.
 */
export function connectThroughProxy(
  proxy: { host: string; port: number },
  host: string,
  port: number,
  secure: ((socket: Socket) => Socket) | null,
  timeoutMs: number,
  signal: AbortSignal
): Promise<Socket> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(abortError())
    const authority = `${isIP(host) === 6 ? `[${host}]` : host}:${port}`
    const tcp = connect({ host: proxy.host, port: proxy.port })
    let tunnel: Socket = tcp
    let reply = Buffer.alloc(0)
    let done = false

    const finish = (error: Error | null): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      tcp.off('data', onData)
      tcp.off('error', onError)
      tunnel.off('error', onError)
      tunnel.off('secureConnect', onSecure)
      if (error) {
        tunnel.destroy()
        tcp.destroy()
        reject(error)
      } else {
        resolve(tunnel)
      }
    }
    const onError = (error: Error): void => finish(error)
    const onAbort = (): void => finish(abortError())
    const onSecure = (): void => finish(null)
    const timer = setTimeout(
      () => finish(new Error('Connection stalled: the device did not answer')),
      timeoutMs
    )

    const onData = (chunk: Buffer): void => {
      reply = Buffer.concat([reply, chunk])
      const end = reply.indexOf('\r\n\r\n')
      if (end < 0) {
        if (reply.length > MAX_REPLY_BYTES) finish(new Error('The device is not an HTTP proxy'))
        return
      }
      const statusLine = reply.subarray(0, reply.indexOf('\r\n')).toString('latin1')
      const status = Number(statusLine.split(' ')[1])
      if (!(status >= 200 && status < 300)) {
        return finish(new Error(`The device's proxy refused the connection (${statusLine})`))
      }
      tcp.off('data', onData)
      // Anything after the reply is already the server's. Servers send nothing before the
      // request, so this is rare; handed back only once whoever takes the socket is reading it.
      const rest = reply.subarray(end + 4)
      if (!secure) {
        if (rest.length > 0) setImmediate(() => tcp.unshift(rest))
        return finish(null)
      }
      if (rest.length > 0) tcp.unshift(rest)
      tunnel = secure(tcp)
      tunnel.once('secureConnect', onSecure)
      tunnel.once('error', onError)
    }

    tcp.once('connect', () =>
      tcp.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n`)
    )
    tcp.on('data', onData)
    tcp.once('error', onError)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/** Opens a tunnel to a well-known site through the device, to tell the user it works. */
export async function testProxy(proxy: { host: string; port: number }): Promise<void> {
  const socket = await connectThroughProxy(
    proxy,
    'www.google.com',
    443,
    null,
    8000,
    new AbortController().signal
  )
  socket.destroy()
}

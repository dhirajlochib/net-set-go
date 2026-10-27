import { useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import { Button } from './ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from './ui/dialog'
import { Input } from './ui/input'

type Test =
  { state: 'idle' } | { state: 'testing' } | { state: 'ok' } | { state: 'failed'; why: string }

/** "192.168.1.20:8080" pasted whole into Address is split into its address and port. */
function splitAddress(address: string): { host: string; port?: string } {
  const match = /^([a-z0-9.-]+):(\d{1,5})$/i.exec(address.trim())
  return match ? { host: match[1], port: match[2] } : { host: address.trim() }
}

/** Adds a phone or laptop running an HTTP proxy as one more network (main/network/proxy.ts). */
export function AddDeviceDialog({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const proxies = useAppStore((store) => store.proxyNetworks)
  const setProxies = useAppStore((store) => store.setProxyNetworks)
  const [name, setName] = useState('')
  const [host, setHost] = useState('')
  const [port, setPort] = useState('8080')
  const [test, setTest] = useState<Test>({ state: 'idle' })

  const portNumber = Number(port)
  const valid =
    name.trim().length > 0 &&
    /^[a-z0-9.:-]{1,253}$/i.test(splitAddress(host).host) &&
    Number.isInteger(portNumber) &&
    portNumber >= 1 &&
    portNumber <= 65535

  const reset = (): void => {
    setName('')
    setHost('')
    setPort('8080')
    setTest({ state: 'idle' })
  }

  const runTest = async (): Promise<void> => {
    setTest({ state: 'testing' })
    const why = await window.netsetgo
      .testProxy(host.trim(), portNumber)
      .catch((error: Error) => error.message)
    setTest(why === null ? { state: 'ok' } : { state: 'failed', why })
  }

  const add = (): void => {
    setProxies([
      ...proxies,
      {
        id: crypto.randomUUID(),
        name: name.trim().slice(0, 60),
        host: host.trim(),
        port: portNumber
      }
    ])
    reset()
    onOpenChange(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset()
        onOpenChange(next)
      }}
    >
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>Add a phone or laptop</DialogTitle>
          <DialogDescription>
            Use another device’s internet as one more network — a phone on a different Wi-Fi, or a
            laptop on another line. Run an HTTP proxy app on it, then enter the address and port the
            app shows. The device has to be reachable from this computer, over USB tethering or the
            same Wi-Fi.
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            if (valid) add()
          }}
        >
          <label className="flex flex-col gap-1.5 text-[12.5px] font-medium">
            Name
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="My phone"
              maxLength={60}
              autoFocus
            />
          </label>
          <div className="grid grid-cols-[1fr_96px] gap-3">
            <label className="flex flex-col gap-1.5 text-[12.5px] font-medium">
              Address
              <Input
                value={host}
                onChange={(event) => {
                  setHost(event.target.value)
                  setTest({ state: 'idle' })
                }}
                onBlur={() => {
                  const split = splitAddress(host)
                  setHost(split.host)
                  if (split.port) setPort(split.port)
                }}
                placeholder="172.20.10.1"
                spellCheck={false}
              />
            </label>
            <label className="flex flex-col gap-1.5 text-[12.5px] font-medium">
              Port
              <Input
                value={port}
                onChange={(event) => {
                  setPort(event.target.value.replace(/\D/g, '').slice(0, 5))
                  setTest({ state: 'idle' })
                }}
                inputMode="numeric"
              />
            </label>
          </div>

          <div className="flex min-h-7 items-center gap-3 text-[12.5px]">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={!valid || test.state === 'testing'}
              onClick={() => void runTest()}
            >
              {test.state === 'testing' ? 'Testing…' : 'Test connection'}
            </Button>
            <span
              role="status"
              className={
                test.state === 'ok'
                  ? 'text-[var(--color-success)]'
                  : test.state === 'failed'
                    ? 'text-[var(--color-danger)]'
                    : 'text-muted-foreground'
              }
            >
              {test.state === 'ok'
                ? 'Connected through the device.'
                : test.state === 'failed'
                  ? test.why
                  : ''}
            </span>
          </div>

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!valid}>
              Add
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

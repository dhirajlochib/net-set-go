import { Menu, nativeImage, Tray, type MenuItemConstructorOptions } from 'electron'
import type { DownloadSummary } from './download/downloadManager'
import type { SpeedUnit } from '../shared/types'

// NetSetGo in the menu bar (macOS) or the tray (Windows and Linux): the total speed beside its
// icon while anything downloads, and a menu with every download in it, so a glance or a click is
// enough without opening the window.

const REFRESH_MS = 1000

export interface MenuBarHooks {
  /** Every download, oldest first. */
  downloads: () => DownloadSummary[]
  speedUnit: () => SpeedUnit
  watchClipboard: () => boolean
  pause: (id: string) => void
  resume: (id: string) => void
  reveal: (id: string) => void
  openWindow: () => void
  newDownload: () => void
  dataUsage: () => void
  setWatchClipboard: (on: boolean) => void
  quit: () => void
}

const ACTIVE = new Set<DownloadSummary['status']>(['downloading', 'queued', 'paused'])

/** Whole numbers from 10 up, like the window's speeds; bits as internet plans count them. */
export function menuBarSpeed(bytesPerSec: number, unit: SpeedUnit): string {
  const steps =
    unit === 'bytes'
      ? { base: 1024, labels: ['B/s', 'KB/s', 'MB/s', 'GB/s'], value: bytesPerSec }
      : { base: 1000, labels: ['bps', 'Kbps', 'Mbps', 'Gbps'], value: bytesPerSec * 8 }
  let value = Math.max(0, steps.value)
  let index = 0
  while (value >= steps.base && index < steps.labels.length - 1) {
    value /= steps.base
    index += 1
  }
  return `${value >= 10 || index === 0 ? Math.round(value) : value.toFixed(1)} ${steps.labels[index]}`
}

function percent(download: DownloadSummary): string {
  return download.totalBytes > 0
    ? `${Math.floor((download.bytesDownloaded / download.totalBytes) * 100)}%`
    : ''
}

export class MenuBar {
  private readonly tray: Tray
  private timer: NodeJS.Timeout
  /** The menu last built, as JSON: rebuilt only when what it shows changes. */
  private shown = ''
  private lastTitle = ''
  private lastTemplate: MenuItemConstructorOptions[] = []

  constructor(
    iconPath: string,
    private readonly hooks: MenuBarHooks
  ) {
    const image = nativeImage.createFromPath(iconPath)
    // A template image takes the menu bar's own color, light or dark.
    if (process.platform === 'darwin') image.setTemplateImage(true)
    this.tray = new Tray(process.platform === 'darwin' ? image : image.resize({ width: 16 }))
    this.tray.setToolTip('NetSetGo')
    // Windows opens the window on a click, as tray apps there do; the menu is a right-click.
    if (process.platform === 'win32') this.tray.on('click', () => hooks.openWindow())
    this.refresh()
    this.timer = setInterval(() => this.refresh(), REFRESH_MS)
    this.timer.unref()
  }

  /** Builds the menu again now, as after a setting it shows changed. */
  refresh(): void {
    const downloads = this.hooks.downloads().filter((download) => ACTIVE.has(download.status))
    const unit = this.hooks.speedUnit()
    const total = downloads.reduce(
      (sum, download) => sum + (download.status === 'downloading' ? download.speedBytesPerSec : 0),
      0
    )
    const title = total > 0 ? menuBarSpeed(total, unit) : ''
    this.lastTitle = title
    if (process.platform === 'darwin') this.tray.setTitle(title, { fontType: 'monospacedDigit' })
    this.tray.setToolTip(title ? `NetSetGo · ${title}` : 'NetSetGo')

    const template = this.template(downloads, unit, total)
    const key = JSON.stringify(template, (_name, value) =>
      typeof value === 'function' ? undefined : value
    )
    if (key === this.shown) return
    this.shown = key
    this.lastTemplate = template
    this.tray.setContextMenu(Menu.buildFromTemplate(template))
  }

  /** What it shows now: the speed beside the icon, and the menu's labels (a submenu's after its
   * item's, indented). For tests. */
  snapshot(): { title: string; items: string[] } {
    const labels = (items: MenuItemConstructorOptions[], indent = ''): string[] =>
      items.flatMap((item) =>
        item.type === 'separator'
          ? ['---']
          : [
              `${indent}${item.label ?? ''}${item.type === 'checkbox' && item.checked ? ' ✓' : ''}`,
              ...(Array.isArray(item.submenu) ? labels(item.submenu, `${indent}  `) : [])
            ]
      )
    return { title: this.lastTitle, items: labels(this.lastTemplate) }
  }

  destroy(): void {
    clearInterval(this.timer)
    this.tray.destroy()
  }

  private template(
    downloads: DownloadSummary[],
    unit: SpeedUnit,
    total: number
  ): MenuItemConstructorOptions[] {
    const { hooks } = this
    const running = downloads.filter((download) => download.status !== 'paused')
    const paused = downloads.filter((download) => download.status === 'paused')
    const items: MenuItemConstructorOptions[] = []

    items.push({
      label:
        downloads.length === 0
          ? 'No downloads in progress'
          : [
              `${downloads.length} ${downloads.length === 1 ? 'download' : 'downloads'}`,
              total > 0 && menuBarSpeed(total, unit)
            ]
              .filter(Boolean)
              .join(' · '),
      enabled: false
    })
    for (const download of downloads) {
      const state =
        download.status === 'paused'
          ? 'Paused'
          : download.status === 'queued'
            ? 'Waiting'
            : menuBarSpeed(download.speedBytesPerSec, unit)
      items.push({
        label: `${download.fileName}  —  ${[percent(download), state].filter(Boolean).join(' · ')}`,
        submenu: [
          download.status === 'paused'
            ? { label: 'Resume', click: () => hooks.resume(download.id) }
            : { label: 'Pause', click: () => hooks.pause(download.id) },
          {
            label: process.platform === 'darwin' ? 'Show in Finder' : 'Show in folder',
            click: () => hooks.reveal(download.id)
          }
        ]
      })
    }
    if (running.length > 1 || paused.length > 1) items.push({ type: 'separator' })
    if (running.length > 1) {
      items.push({
        label: 'Pause all',
        click: () => running.forEach((download) => hooks.pause(download.id))
      })
    }
    if (paused.length > 1) {
      items.push({
        label: 'Resume all',
        click: () => paused.forEach((download) => hooks.resume(download.id))
      })
    }

    items.push(
      { type: 'separator' },
      { label: 'New download…', click: () => hooks.newDownload() },
      { label: 'Data usage…', click: () => hooks.dataUsage() },
      {
        label: 'Offer links you copy',
        type: 'checkbox',
        checked: hooks.watchClipboard(),
        click: (item) => hooks.setWatchClipboard(item.checked)
      },
      { type: 'separator' },
      { label: 'Open NetSetGo', click: () => hooks.openWindow() },
      { label: 'Quit NetSetGo', click: () => hooks.quit() }
    )
    return items
  }
}

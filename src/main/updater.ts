import {
  app,
  dialog,
  Menu,
  shell,
  type BrowserWindow,
  type MenuItemConstructorOptions
} from 'electron'
import { autoUpdater } from 'electron-updater'
import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { IpcChannels } from '../shared/ipc-channels'
import type { UpdateState } from '../shared/types'
import { saveSettings } from './settings'

const CHECK_EVERY_MS = 4 * 60 * 60_000
/** Where an update the app couldn't install itself is downloaded from instead. */
const DOWNLOAD_PAGE = 'https://netsetgo.dhirajlochib.com/'

let state: UpdateState = { status: 'idle', autoUpdate: true }
let getWindow: () => BrowserWindow | null = () => null
/** A check asked for from the menu answers even when there's nothing new. */
let asked = false
/** Whether this build can install an update itself (see canInstallUpdates). */
let installs = true

/**
 * macOS installs an update only over an app signed with a Developer ID, by checking the new
 * version against the running one's signing identity. An ad-hoc signature's identity is a hash
 * of that one build, which no other build can match: the download would always be turned away
 * at install time. Such a build sends the user to the website instead of downloading.
 */
async function canInstallUpdates(): Promise<boolean> {
  if (process.platform !== 'darwin') return true
  // …/NetSetGo.app/Contents/MacOS/NetSetGo → …/NetSetGo.app
  const bundle = join(app.getPath('exe'), '..', '..', '..')
  try {
    const { stderr } = await promisify(execFile)('codesign', ['-dv', bundle])
    return /^TeamIdentifier=(?!not set)\S+/m.test(stderr)
  } catch {
    return false
  }
}

export function updateState(): UpdateState {
  return state
}

function set(patch: Partial<UpdateState>): void {
  const before = state
  state = { ...state, ...patch }
  getWindow()?.webContents.send(IpcChannels.updateStateChanged, state)
  // Progress alone changes no menu item.
  if (state.status !== before.status || state.autoUpdate !== before.autoUpdate) setAppMenu()
}

function answer(message: string, detail?: string): void {
  if (!asked) return
  asked = false
  void dialog.showMessageBox({ message, detail })
}

function check(fromMenu = false): void {
  const { status } = state
  // A failed install isn't retried on a timer: on an unsigned Mac it would fail again, after
  // downloading the whole update again.
  if (status === 'checking' || status === 'downloading' || status === 'ready') return
  if (status === 'error' && !fromMenu) return
  asked = fromMenu
  // A failure is reported by the 'error' event too. Unpackaged (dev, e2e), this does nothing.
  autoUpdater.checkForUpdates().catch(() => {})
}

function download(): void {
  set({ status: 'downloading', percent: 0 })
  autoUpdater.downloadUpdate().catch(() => {})
}

function setAutoUpdate(on: boolean): void {
  autoUpdater.autoDownload = on && installs
  set({ autoUpdate: on })
  saveSettings({ autoUpdate: on }).catch((error) =>
    console.error('[netsetgo] failed to save the automatic updates setting', error)
  )
  if (on && state.status === 'available') download()
}

/** The same items in the macOS app menu and in the menu the status bar's update button opens —
 * Windows and Linux windows show no menu bar, so that button is their only way to these. */
function menuItems(): MenuItemConstructorOptions[] {
  const { status, version } = state
  const items: MenuItemConstructorOptions[] = []
  if (status === 'ready') {
    // Silent, and opened again after: the installer's own pages were all answered the first time.
    items.push({
      label: `Restart to Update to ${version}`,
      click: () => autoUpdater.quitAndInstall(true, true)
    })
  } else if (status === 'downloading') {
    items.push({ label: `Downloading ${version}…`, enabled: false })
  } else if (status === 'available') {
    items.push({ label: `Download NetSetGo ${version}`, click: download })
  } else if (status === 'error' || status === 'website') {
    items.push({
      label: `Get NetSetGo ${version} from the Website…`,
      click: () => void shell.openExternal(DOWNLOAD_PAGE)
    })
  }
  items.push(
    {
      label: status === 'checking' ? 'Checking for Updates…' : 'Check for Updates…',
      enabled: status === 'idle' || status === 'available' || status === 'error',
      click: () => check(true)
    },
    {
      label: 'Update Automatically',
      type: 'checkbox',
      checked: state.autoUpdate,
      click: (item) => setAutoUpdate(item.checked)
    }
  )
  return items
}

export function showUpdateMenu(): void {
  const window = getWindow()
  if (window) Menu.buildFromTemplate(menuItems()).popup({ window })
}

/** Electron's default macOS menu, with the update items under the app's name. */
function setAppMenu(): void {
  if (process.platform !== 'darwin') return
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: app.name,
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          ...menuItems(),
          { type: 'separator' },
          { role: 'services' },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' }
        ]
      },
      { role: 'fileMenu' },
      { role: 'editMenu' },
      { role: 'viewMenu' },
      { role: 'windowMenu' }
    ])
  )
}

/** Checks GitHub Releases now and every few hours (see electron-builder.yml's publish), for the
 * release GitHub marks Latest. A downloaded update installs on restart, or on the next quit if
 * there isn't one. */
export function startUpdater(window: () => BrowserWindow | null, autoUpdate: boolean): void {
  getWindow = window
  state = { ...state, autoUpdate }
  autoUpdater.autoDownload = autoUpdate
  // On by default for an rc build, and then it only ever looks for newer rc tags: 1.0.0 would
  // never reach it. Off, every build follows Latest, whatever its version. A release marked
  // pre-release on GitHub is never Latest, so it reaches nobody.
  autoUpdater.allowPrerelease = false

  autoUpdater.on('checking-for-update', () => set({ status: 'checking' }))
  autoUpdater.on('update-not-available', () => {
    set({ status: 'idle', version: undefined })
    answer('You’re up to date', `NetSetGo ${app.getVersion()} is the newest version.`)
  })
  autoUpdater.on('update-available', ({ version }) => {
    asked = false
    if (!installs) return set({ status: 'website', version })
    set({ status: autoUpdater.autoDownload ? 'downloading' : 'available', version, percent: 0 })
  })
  autoUpdater.on('download-progress', ({ percent }) => {
    const whole = Math.floor(percent)
    if (whole !== state.percent) set({ status: 'downloading', percent: whole })
  })
  autoUpdater.on('update-downloaded', ({ version }) => set({ status: 'ready', version }))
  autoUpdater.on('error', (error) => {
    console.error('[netsetgo] update failed', error)
    // Before an update is found (offline, GitHub down) there's nothing to show. After, the
    // website still has it — the way an unsigned Mac build, which can't install it, gets it.
    set({ status: state.version ? 'error' : 'idle' })
    answer('Couldn’t check for updates', 'Check your connection and try again.')
  })

  setAppMenu()
  void canInstallUpdates().then((can) => {
    installs = can
    if (!can) autoUpdater.autoDownload = false
    check()
    setInterval(check, CHECK_EVERY_MS)
  })
}

import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { app, BrowserWindow, Menu, nativeTheme, shell } from 'electron'
import { join } from 'path'
import icon from '../../resources/icon-dark.png?asset'
import trayIcon from '../../resources/trayTemplate.png?asset'
import { registerIpcHandlers } from './ipc/handlers'
import { keepsRunningForBrowser, startBridge } from './browserBridge'
import { ClipboardWatcher } from './clipboardWatcher'
import { MenuBar } from './menuBar'
import { acceptedLink, bringForward, linkFromArgs, offerLink, queueFoundLink } from './openLinks'
import {
  loadSettings,
  loadThemeSource,
  migrateLegacyNetworkPreferences,
  saveSettings
} from './settings'
import { startUpdater } from './updater'
import { testKnobs } from './testKnobs'
import type { DownloadManager } from './download/downloadManager'
import { IpcChannels } from '../shared/ipc-channels'
import type { MenuAction } from '../shared/types'

// In dev mode the app runs as the raw `electron` binary, which otherwise shows "Electron" in
// the Dock tooltip/menu bar — must be set before the app is ready. Packaged builds already get
// this from electron-builder's productName, but setting it here keeps dev and packaged in sync.
app.setName('NetSetGo')

// Each e2e test runs against its own throwaway userData folder (downloads, manifests, settings).
if (testKnobs.userDataDir) app.setPath('userData', testKnobs.userDataDir)

// One NetSetGo at a time (per userData folder, so parallel e2e runs each have their own): a second
// launch — a magnet link clicked, a .torrent opened — hands its link to the first and exits.
if (!app.requestSingleInstanceLock()) app.exit(0)

let mainWindow: BrowserWindow | null = null
let downloadManager: DownloadManager | null = null
let quitAfterSuspending = false
let menuBar: MenuBar | null = null

/** Only once the app is ready. */
function ensureWindow(): BrowserWindow {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow()
  return mainWindow as BrowserWindow
}

/** A link the OS handed over goes to the window's link field (see openLinks.ts). */
function offer(candidate: string): void {
  const link = acceptedLink(candidate)
  if (!link) return
  // Before the app is ready the link waits; the window takes it once it opens.
  offerLink({ url: link }, app.isReady() ? ensureWindow() : null)
}

// A netsetgo:// link from the browser extension arrives here too, with no link in it.
app.on('second-instance', (_event, argv) => {
  const link = linkFromArgs(argv)
  if (link) return offer(link)
  bringForward(ensureWindow())
})
// macOS hands links over as events, and may do so before the app is ready.
app.on('open-url', (event, url) => {
  event.preventDefault()
  offer(url)
})
app.on('open-file', (event, path) => {
  event.preventDefault()
  offer(path)
})
// Windows and Linux put the first launch's link on its command line.
const launchLink = linkFromArgs(process.argv)
if (launchLink) offer(launchLink)

/** The Windows/Linux window controls, in the toolbar's colors (main.css's --bg and --text)
 * for the theme in use, at its height. */
function titleBarOverlay(): Electron.TitleBarOverlayOptions {
  const dark = nativeTheme.shouldUseDarkColors
  return {
    color: dark ? '#1e1e1e' : '#ffffff',
    symbolColor: dark ? '#f5f5f7' : '#1d1d1f',
    height: 52
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 760,
    height: 640,
    minWidth: 720,
    // Room under the download screen's pinned block grid for a network row and a few of its rows.
    minHeight: 620,
    show: false,
    autoHideMenuBar: true,
    title: 'NetSetGo',
    // Matches the renderer's dark-mode background so a live window resize
    // (which briefly exposes the raw window background) doesn't flash white.
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1e1e1e' : '#ffffff',
    ...(process.platform !== 'darwin' ? { icon } : {}),
    // One title bar on every OS: the renderer's toolbar (see Toolbar.tsx), with the OS's window
    // controls over it — macOS's traffic lights, or the minimize/maximize/close that Windows and
    // Linux draw over the toolbar's right end.
    titleBarStyle: 'hidden',
    ...(process.platform === 'darwin'
      ? // Center the 14px native buttons in the renderer's 52px toolbar (Toolbar.tsx).
        { trafficLightPosition: { x: 20, y: 19 } }
      : { titleBarOverlay: titleBarOverlay() }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // A hidden e2e window would otherwise have its timers throttled.
      backgroundThrottling: !testKnobs.hideWindow
    }
  })

  mainWindow.on('ready-to-show', () => {
    if (!testKnobs.hideWindow) mainWindow?.show()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    // Only hand http(s) links to the OS shell — an arbitrary scheme (e.g. a custom protocol
    // handler) reaching shell.openExternal is a known Electron risk if this ever fires with
    // attacker- or server-influenced data.
    if (/^https?:/i.test(details.url)) void shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // Electron shows no right-click menu of its own: give every text field Cut/Copy/Paste, and any
  // selected text Copy.
  mainWindow.webContents.on('context-menu', (_, { isEditable, selectionText, editFlags }) => {
    const template: Electron.MenuItemConstructorOptions[] = isEditable
      ? [
          { role: 'cut', enabled: editFlags.canCut },
          { role: 'copy', enabled: editFlags.canCopy },
          { role: 'paste', enabled: editFlags.canPaste },
          { type: 'separator' },
          { role: 'selectAll', enabled: editFlags.canSelectAll }
        ]
      : selectionText.trim()
        ? [{ role: 'copy' }]
        : []
    if (template.length) Menu.buildFromTemplate(template).popup()
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.dhirajlochib.netsetgo')

  // A failed move keeps the old file, to retry next launch — it must never stop the window opening.
  await migrateLegacyNetworkPreferences().catch((error) =>
    console.error('[netsetgo] failed to migrate network-preferences.json', error)
  )

  // The macOS About window (NetSetGo › About NetSetGo); its copyright comes from electron-builder.yml.
  app.setAboutPanelOptions({
    credits: 'Developed by Dhiraj Lochib.'
  })

  // Applied before the window is created so the initial background/icon already match —
  // the saved preference otherwise only takes effect on the next 'updated' event.
  nativeTheme.themeSource = await loadThemeSource()

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  const clipboardWatcher = new ClipboardWatcher({
    appFocused: () => BrowserWindow.getFocusedWindow() !== null,
    queue: (link) => queueFoundLink({ url: link, from: 'your clipboard' }, mainWindow),
    show: () => bringForward(ensureWindow())
  })
  // What main itself runs off settings, kept as last saved.
  let settings = await loadSettings()
  const applySettings = (saved: typeof settings): void => {
    settings = saved
    void clipboardWatcher.setEnabled(saved.watchClipboard === true)
    menuBar?.refresh()
  }
  const manager = registerIpcHandlers(() => mainWindow, applySettings)
  downloadManager = manager
  applySettings(settings)
  const sendToWindow = (action: MenuAction): void => {
    const window = ensureWindow()
    bringForward(window)
    window.webContents.send(IpcChannels.menuAction, action)
  }
  menuBar = new MenuBar(process.platform === 'darwin' ? trayIcon : icon, {
    downloads: () => manager.summaries(),
    speedUnit: () => settings.speedUnit ?? 'bytes',
    watchClipboard: () => settings.watchClipboard === true,
    pause: (id) => void manager.pause(id).catch(() => {}),
    resume: (id) => manager.resume(id),
    reveal: (id) => void manager.reveal(id),
    openWindow: () => bringForward(ensureWindow()),
    newDownload: () => sendToWindow({ type: 'new-download' }),
    dataUsage: () => sendToWindow({ type: 'data-usage' }),
    setWatchClipboard: (on) => {
      applySettings({ ...settings, watchClipboard: on })
      void saveSettings({ watchClipboard: on })
      mainWindow?.webContents.send(IpcChannels.menuAction, { type: 'watch-clipboard', on })
    },
    quit: () => app.quit()
  })
  if (testKnobs.userDataDir) (globalThis as Record<string, unknown>).__menuBar = menuBar
  void startBridge({
    manager: downloadManager,
    offer: (link) => offerLink(link, ensureWindow())
  }).catch((error) => console.error('[netsetgo] browser bridge failed to start', error))
  // Unlike magnet:, netsetgo:// is NetSetGo's own, so registering it takes nothing from another app. A
  // development build has no fixed path to register.
  if (app.isPackaged) app.setAsDefaultProtocolClient('netsetgo')

  nativeTheme.on('updated', () => {
    mainWindow?.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#1c1c1e' : '#ffffff')
    if (process.platform !== 'darwin') mainWindow?.setTitleBarOverlay(titleBarOverlay())
  })

  createWindow()
  if (testKnobs.hideWindow) app.dock?.hide()
  startUpdater(() => mainWindow, (await loadSettings()).autoUpdate !== false)

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', (event) => {
  if (quitAfterSuspending || !downloadManager) return

  event.preventDefault()

  // Guarantee the process exits even if suspending hangs
  const forceQuitTimeout = setTimeout(() => {
    app.exit(0)
  }, 3000)

  void downloadManager.suspendAll().finally(() => {
    clearTimeout(forceQuitTimeout)
    quitAfterSuspending = true
    app.exit(0)
  })
})

app.on('window-all-closed', () => {
  if (process.platform === 'darwin') return
  if (!keepsRunningForBrowser()) return app.quit()
  // Kept running in the menu bar item (see menuBar.ts), so the browser extension can still
  // reach it.
})

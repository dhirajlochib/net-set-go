# NetSetGo Roadmap

Where NetSetGo is headed after 1.0. Each item gets its own issue before work starts; this file is
the overview.

Legend: **S** small (a day or two) · **M** medium (about a week) · **L** large (several weeks)

---

## Phase 2 — Design refresh: calm, native, Apple-like

Goal: the app should feel like it shipped with macOS — quiet by default, detailed when you look
closer — while staying at home on Windows and Linux.

### Foundations

| Item             | What changes                                                                                                                                                                | Size |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| Type             | System font stack (`-apple-system, "SF Pro Text", "Segoe UI Variable", system-ui`) instead of the bundled Manrope; SF Mono / Cascadia for numbers. Tighter type scale.      | S    |
| Color tokens     | One accent (system blue `#0A84FF`, or the user's OS accent via `systemPreferences.getAccentColor()`), neutral grays, semantic success / warning / danger. Retune dark mode. | S    |
| Spacing & radius | 4/8 pt grid; 10 px controls, 14 px cards, 20 px sheets — continuous-corner feel.                                                                                            | S    |
| Window chrome    | macOS: `titleBarStyle: 'hiddenInset'` + sidebar `vibrancy`. Windows 11: `backgroundMaterial: 'mica'`. Linux: solid fallback.                                                | M    |
| Motion           | Short spring transitions for sheets, row insert/remove and progress; respects _Reduce Motion_.                                                                              | S    |
| Icons            | Lucide at 1.5 stroke, sized to match SF Symbols weights.                                                                                                                    | S    |

### Layout

| Item               | What changes                                                                                                                | Size |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------- | ---- |
| Sidebar navigation | _All · Active · Completed · Torrents · Scheduled_ plus a _Networks_ section with live per-network speed.                    | M    |
| Unified toolbar    | Add (+), search, pause-all/resume-all, view options; title bar doubles as toolbar.                                          | M    |
| Download rows      | Single-line rows: file-type icon, name, slim progress bar, speed, ETA. Detail opens in an inspector pane, not a new screen. | M    |
| Inspector          | Right-hand pane: network split diagram, throughput chart, block grid, file list for torrents, link & checksum info.         | M    |
| New-download sheet | Paste detection, a one-line form by default, _Advanced_ disclosure for streams, networks, schedule and folder.              | M    |
| Empty states       | Friendly illustration + drag-and-drop hint + _Paste link_ button.                                                           | S    |
| Settings window    | Native-style tabbed preferences (General · Networks · Limits · Browser · Advanced) instead of dialogs.                      | M    |

---

## Phase 3 — Features

### Next up

| Feature                  | Why                                                                           | Size |
| ------------------------ | ----------------------------------------------------------------------------- | ---- |
| Clipboard link detection | Copy a link anywhere → NetSetGo offers to download it (opt-in).               | S    |
| Drag & drop              | Drop links, `.torrent` files or text onto the window or Dock icon.            | S    |
| Completion notifications | Native notification with _Open_ / _Show in Folder_ actions.                   | S    |
| Menu-bar mini window     | Live total speed and active downloads from the tray, without opening the app. | M    |
| Command palette (⌘K)     | Every action searchable; keyboard-first workflow.                             | M    |
| Search & filters         | Filter history by name, type, date, status, site.                             | S    |
| Auto-sort into folders   | Video / Music / Archives / Documents / Apps rules, editable.                  | S    |
| Checksum verification    | Paste a SHA-256/MD5 → verified automatically when the download finishes.      | S    |
| Batch import             | Paste many links or load a `.txt`; all queued at once.                        | S    |
| Quick Look               | Space bar previews a completed file (`BrowserWindow.previewFile` on macOS).   | S    |

### Power features

| Feature                       | Why                                                                                          | Size |
| ----------------------------- | -------------------------------------------------------------------------------------------- | ---- |
| Multi-mirror downloads        | Same file from several URLs at once — mirrors × networks.                                    | L    |
| Post-download actions         | Auto-extract archives, open, move, run a script, sleep or shut down when the queue finishes. | M    |
| Usage dashboard               | Data used per network per day/week/month; charts against the allowances already supported.   | M    |
| CLI + local API               | `netsetgo add <url>`, `netsetgo ls`, plus a localhost API for scripts and automations.       | M    |
| Shortcuts / Raycast / Alfred  | Built on the `netsetgo://` scheme and the local API.                                         | M    |
| Site rules                    | Per-site headers, cookies, stream limits and save folders.                                   | M    |
| Sequential torrent mode       | Download in order so video can be previewed while it downloads.                              | M    |
| Torrent RSS feeds             | Subscribe and auto-download matching items.                                                  | M    |
| Media-site support (optional) | Optional yt-dlp integration for pages, not just direct links.                                | L    |
| Safari extension              | Browser integration for Safari users.                                                        | M    |

### Polish & reach

| Item                                                                     | Size |
| ------------------------------------------------------------------------ | ---- |
| Localization (i18n)                                                      | M    |
| Full keyboard & VoiceOver pass                                           | M    |
| Homebrew cask, winget, Flathub                                           | S    |
| Code signing & notarization                                              | S    |
| Retint landing page (docs/) from the old orange to the blue/indigo brand | S    |
| Portable mode on Windows                                                 | S    |

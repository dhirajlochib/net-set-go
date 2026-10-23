/*
 * What's new in each version: the top of its GitHub Release's notes (scripts/release-notes.mjs).
 * A version tag with no entry here doesn't build (.github/workflows/release.yml), so add the
 * entry in the same PR as the version bump, newest first.
 *
 * `kind` is one of new, faster, improved or fixed; `text` may wrap `code` in backticks.
 */
;(function (root) {
  'use strict'

  root.NetSetGoChangelog = [
    {
      version: 'v1.0.0',
      items: [
        {
          kind: 'new',
          title: 'NetSetGo 1.0',
          text: 'The first release of NetSetGo: one download, split across every network you have — Wi-Fi, Ethernet and a USB-tethered phone — at the same time.'
        },
        {
          kind: 'new',
          title: 'Links and torrents',
          text: 'Paste a link, open a .torrent or click a magnet link. Torrents use the same networks you picked for everything else.'
        },
        {
          kind: 'new',
          title: 'Downloads from your browser',
          text: 'The NetSetGo extension for Chrome, Edge and Firefox hands a download over with your sign-in, so files behind a login download as they do in the browser.'
        },
        {
          kind: 'new',
          title: 'Limits and schedules',
          text: 'Cap speed or data per network, and let downloads run only at set times, like overnight, under Networks → Speed & data limits.'
        },
        {
          kind: 'new',
          title: 'Automatic updates',
          text: 'New versions download in the background and install when you restart.'
        }
      ]
    }
  ]
})(typeof window !== 'undefined' ? window : module.exports)

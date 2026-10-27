/** What reads as a file to download rather than a page to visit. */
const FILE_EXTENSION =
  /\.(zip|7z|rar|tar|gz|tgz|bz2|xz|zst|iso|img|dmg|pkg|exe|msi|msix|appimage|deb|rpm|apk|ipa|xip|mp4|mkv|mov|avi|webm|m4v|mp3|flac|wav|m4a|aac|ogg|pdf|epub|torrent|bin|jar|whl)$/i

/** A magnet link, or an http(s) link to what looks like a file; null for anything else, a page's
 * address and text that only contains a link included. */
export function downloadableLink(text: string): string | null {
  const candidate = text.trim()
  if (candidate.length > 4096 || /\s/.test(candidate)) return null
  if (/^magnet:\?/i.test(candidate)) return candidate
  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  const name = safeDecode(url.pathname.split('/').pop() ?? '')
  return FILE_EXTENSION.test(name) ? candidate : null
}

/** A path segment with its %-escapes undone, or as it is when they're malformed. */
export function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

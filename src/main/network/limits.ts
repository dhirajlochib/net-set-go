import { join } from 'node:path'
import { app } from 'electron'
import { dataPeriodKey } from '../../shared/dataLimits'
import { DEFAULT_SLOW_MODE_SPEED, type AppSettings, type DataLimitPeriod } from '../../shared/types'
import { readJson, updateJson } from '../jsonFile'

// Speed and data limits, for every download together: what the user sets in Speed & data limits.
// Every byte NetSetGo receives passes through take(), on the network it came in on — an HTTP
// response's body and a torrent peer's socket alike — which says how long to stop reading for.
// Stopping reading is what slows the sender: TCP's window fills, and it waits.

/** A rate as a bucket of tokens (bytes) that refills at `rate` per second. Taking more than it
 * holds leaves it in debt, and the debt is the wait. A second's worth is all it ever holds, so a
 * quiet spell doesn't buy a burst over the limit. */
class Bucket {
  private tokens = 0
  private at = Date.now()

  constructor(public rate: number) {}

  /** Takes `bytes`, and says how many ms to wait before taking more. */
  take(bytes: number, now: number): number {
    this.tokens = Math.min(this.rate, this.tokens + ((now - this.at) / 1000) * this.rate)
    this.at = now
    this.tokens -= bytes
    return this.tokens >= 0 ? 0 : (-this.tokens / this.rate) * 1000
  }
}

type Usage = { key: string; bytes: Record<string, number> }
const PERIODS: DataLimitPeriod[] = ['day', 'week', 'month']
function freshUsage(time: number): Record<DataLimitPeriod, Usage> {
  return {
    day: { key: dataPeriodKey('day', time), bytes: {} },
    week: { key: dataPeriodKey('week', time), bytes: {} },
    month: { key: dataPeriodKey('month', time), bytes: {} }
  }
}

const USAGE_SAVE_MS = 10_000
/** Days of per-network history kept for the usage chart. */
export const USAGE_HISTORY_DAYS = 90

export class Limits {
  private total: Bucket | null = null
  private perNetwork = new Map<string, Bucket>()
  /** Each network's data limit and selected calendar period. */
  private dataLimits = new Map<string, number>()
  private periods = new Map<string, DataLimitPeriod>()
  private usage = freshUsage(Date.now())
  /** Bytes per network per local calendar day ("YYYY-MM-DD"), for the usage chart. Unlike the
   * period counters, resetting a network's usage doesn't touch it: it's a record, not a limit. */
  private history: Record<string, Record<string, number>> = {}
  private saveTimer: NodeJS.Timeout | null = null
  readonly loaded: Promise<void>

  /** `onLimitReached` is told when a network uses up its data for its selected period. */
  constructor(private readonly onLimitReached: () => void) {
    this.loaded = readJson(this.usagePath())
      .then((saved) => {
        if (!saved || typeof saved !== 'object') return
        const record = saved as Record<string, unknown>
        this.history = readHistory(record.history, Date.now())
        // Older releases saved only monthly usage. Preserve it without attributing it to a day or week.
        const entries =
          record.version === 2
            ? record.periods
            : {
                month: { key: record.month, bytes: record.bytes }
              }
        if (!entries || typeof entries !== 'object') return
        for (const period of PERIODS) {
          const entry = (entries as Record<string, unknown>)[period]
          if (!entry || typeof entry !== 'object') continue
          const { key, bytes } = entry as { key?: unknown; bytes?: unknown }
          if (
            key !== this.usage[period].key ||
            !bytes ||
            typeof bytes !== 'object' ||
            Array.isArray(bytes)
          )
            continue
          for (const [id, used] of Object.entries(bytes)) {
            if (Number.isSafeInteger(used) && used >= 0) this.usage[period].bytes[id] = used
          }
        }
      })
      .catch(() => {})
  }

  private usagePath(): string {
    return join(app.getPath('userData'), 'network-usage.json')
  }

  /** Takes up the limits in `settings`. Slow mode, when on, stands in for the total limit. */
  configure(settings: AppSettings): void {
    // A slow mode speed never changed isn't saved: it's the default the window shows.
    const total = settings.slowMode
      ? (settings.slowModeSpeed ?? DEFAULT_SLOW_MODE_SPEED)
      : settings.speedLimit
    this.total = adjust(this.total, total)
    const preferences = settings.networkPreferences ?? {}
    for (const id of new Set([...this.perNetwork.keys(), ...Object.keys(preferences)])) {
      const bucket = adjust(this.perNetwork.get(id) ?? null, preferences[id]?.speedLimit)
      if (bucket) this.perNetwork.set(id, bucket)
      else this.perNetwork.delete(id)
    }
    this.dataLimits.clear()
    this.periods.clear()
    for (const [id, preference] of Object.entries(preferences)) {
      this.periods.set(id, preference.dataLimitPeriod ?? 'month')
      if (preference.dataLimit !== undefined) this.dataLimits.set(id, preference.dataLimit)
    }
  }

  /** Counts `bytes` just received on `networkId`, and says how many ms to stop reading for. */
  take(networkId: string, bytes: number): number {
    const now = Date.now()
    this.rollPeriods(now)
    const period = this.periods.get(networkId) ?? 'month'
    const before = this.usage[period].bytes[networkId] ?? 0
    for (const entry of Object.values(this.usage)) {
      entry.bytes[networkId] = (entry.bytes[networkId] ?? 0) + bytes
    }
    const day = (this.history[this.usage.day.key] ??= {})
    day[networkId] = (day[networkId] ?? 0) + bytes
    this.saveTimer ??= setTimeout(() => void this.save(), USAGE_SAVE_MS)
    const limit = this.dataLimits.get(networkId)
    // Told once the caller is done with its bytes: what it does may stop the very connection
    // they came in on.
    if (limit !== undefined && before < limit && before + bytes >= limit) {
      setImmediate(this.onLimitReached)
    }
    return Math.max(
      this.total?.take(bytes, now) ?? 0,
      this.perNetwork.get(networkId)?.take(bytes, now) ?? 0
    )
  }

  /** Whether the network has used up its data for the selected period. */
  limitReached(networkId: string): boolean {
    this.rollPeriods(Date.now())
    const limit = this.dataLimits.get(networkId)
    return (
      limit !== undefined &&
      (this.usage[this.periods.get(networkId) ?? 'month'].bytes[networkId] ?? 0) >= limit
    )
  }

  /** Each network's usage for its selected calendar period. */
  usedByPeriod(): Record<string, number> {
    this.rollPeriods(Date.now())
    const ids = new Set(Object.values(this.usage).flatMap((entry) => Object.keys(entry.bytes)))
    return Object.fromEntries(
      [...ids].map((id) => [id, this.usage[this.periods.get(id) ?? 'month'].bytes[id] ?? 0])
    )
  }

  /** Bytes per network for each of the last `days` days that had any, oldest first. */
  dailyHistory(days = USAGE_HISTORY_DAYS): { day: string; bytes: Record<string, number> }[] {
    const first = dataPeriodKey('day', Date.now() - (days - 1) * DAY_MS)
    return Object.keys(this.history)
      .filter((day) => day >= first)
      .sort()
      .map((day) => ({ day, bytes: { ...this.history[day] } }))
  }

  /** Reset only the selected network's current period; other periods retain their usage. */
  async resetUsage(networkId: string): Promise<void> {
    await this.loaded
    this.rollPeriods(Date.now())
    const period = this.periods.get(networkId) ?? 'month'
    const previous = this.usage[period].bytes[networkId] ?? 0
    this.usage[period].bytes[networkId] = 0
    try {
      const snapshot = this.snapshot()
      await updateJson(this.usagePath(), () => snapshot)
    } catch (error) {
      this.usage[period].bytes[networkId] += previous
      throw error
    }
  }

  /** Writes every period’s usage now (on quit; otherwise it's saved every USAGE_SAVE_MS). */
  async save(): Promise<void> {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = null
    this.rollPeriods(Date.now(), false)
    const usage = this.snapshot()
    await updateJson(this.usagePath(), () => usage).catch(() => {})
  }

  private snapshot(): object {
    this.history = readHistory(this.history, Date.now())
    return {
      version: 2,
      periods: structuredClone(this.usage),
      history: structuredClone(this.history)
    }
  }

  private rollPeriods(now: number, scheduleSave = true): void {
    let changed = false
    for (const period of PERIODS) {
      const key = dataPeriodKey(period, now)
      if (key !== this.usage[period].key) {
        this.usage[period] = { key, bytes: {} }
        changed = true
      }
    }
    if (changed && scheduleSave)
      this.saveTimer ??= setTimeout(() => void this.save(), USAGE_SAVE_MS)
  }
}

const DAY_MS = 24 * 60 * 60 * 1000

/** A saved day → network → bytes record, cleaned of anything malformed and of days past the
 * kept window. */
function readHistory(saved: unknown, now: number): Record<string, Record<string, number>> {
  const history: Record<string, Record<string, number>> = {}
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return history
  const first = dataPeriodKey('day', now - (USAGE_HISTORY_DAYS - 1) * DAY_MS)
  for (const [day, networks] of Object.entries(saved)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day < first) continue
    if (!networks || typeof networks !== 'object' || Array.isArray(networks)) continue
    for (const [id, bytes] of Object.entries(networks)) {
      if (Number.isSafeInteger(bytes) && (bytes as number) > 0) {
        ;(history[day] ??= {})[id] = bytes as number
      }
    }
  }
  return history
}

/** The bucket for `rate` bytes a second: `current` changed in place, so a debt carries over, or
 * none for no limit. */
function adjust(current: Bucket | null, rate: number | undefined): Bucket | null {
  if (rate === undefined || !(rate > 0)) return null
  if (!current) return new Bucket(rate)
  current.rate = rate
  return current
}

import type { DailyUsage, NetworkInterfaceKind } from '@shared/types'
import { dataPeriodKey } from '@shared/dataLimits'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNetworkVisuals } from '../hooks/useNetworkVisuals'
import { useAppStore } from '../store/useAppStore'
import { formatBytes } from '../utils/format'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog'
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group'

const RANGES = [7, 30, 90] as const
type Range = (typeof RANGES)[number]

const DAY_MS = 24 * 60 * 60 * 1000
const CHART_HEIGHT = 168
/** Room above the top gridline for its label. */
const TOP_PAD = 8
/** Room left of the bars for the byte labels on the gridlines. */
const AXIS_WIDTH = 56
/** The surface-colored gap between stacked segments and between neighboring bars. */
const GAP = 2

interface Series {
  id: string
  name: string
  color: string
  total: number
}

/** Every day in the range, oldest first, including the ones nothing was downloaded on. */
function daysBack(range: Range, now: number): string[] {
  return Array.from({ length: range }, (_, index) =>
    dataPeriodKey('day', now - (range - 1 - index) * DAY_MS)
  )
}

function shortDate(day: string): string {
  const [year, month, date] = day.split('-').map(Number)
  return new Date(year, month - 1, date).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric'
  })
}

/** A round top for the y axis in the units sizes are shown in (1024s), so the gridlines read
 * as 0, 1 GB, 2 GB rather than 0, 2.3 GB, 4.7 GB. */
function niceMax(value: number): number {
  if (value <= 0) return 1
  const unit = 1024 ** Math.floor(Math.log(value) / Math.log(1024))
  const scaled = value / unit
  const magnitude = 10 ** Math.floor(Math.log10(scaled))
  const step = [1, 2, 4, 5, 6, 8, 10].find((candidate) => candidate * magnitude >= scaled)!
  return step * magnitude * unit
}

/** How much each network downloaded per day, as stacked bars, with totals for the range. */
export function UsageDialog({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  // When it was read too: "today" is the last day in it, not whenever the dialog re-renders.
  const [history, setHistory] = useState<{ days: DailyUsage[]; at: number } | null>(null)
  const [range, setRange] = useState<Range>(30)
  const [hovered, setHovered] = useState<number | null>(null)
  const [width, setWidth] = useState(0)
  // A callback ref: the chart only mounts once there's history to draw.
  const observer = useRef<ResizeObserver | null>(null)
  const measure = useCallback((node: HTMLDivElement | null) => {
    observer.current?.disconnect()
    observer.current = null
    if (!node) return
    observer.current = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.current.observe(node)
  }, [])
  const interfaces = useAppStore((store) => store.interfaces)
  const preferences = useAppStore((store) => store.networkPreferences)
  const networkVisual = useNetworkVisuals()

  useEffect(() => {
    if (!open) return
    let current = true
    void window.netsetgo.usageHistory().then(
      (days) => current && setHistory({ days, at: Date.now() }),
      () => current && setHistory({ days: [], at: Date.now() })
    )
    return () => {
      current = false
    }
  }, [open])

  const days = useMemo(() => (history ? daysBack(range, history.at) : []), [range, history])
  const byDay = useMemo(
    () => new Map((history?.days ?? []).map((entry) => [entry.day, entry.bytes])),
    [history]
  )

  // Biggest first, so the legend and the stack read in the same order.
  const series: Series[] = useMemo(() => {
    const totals = new Map<string, number>()
    for (const day of days) {
      for (const [id, bytes] of Object.entries(byDay.get(day) ?? {})) {
        totals.set(id, (totals.get(id) ?? 0) + bytes)
      }
    }
    return [...totals]
      .filter(([, total]) => total > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([id, total]) => {
        const iface = interfaces.find((entry) => entry.id === id)
        const kind: NetworkInterfaceKind = iface?.kind ?? 'other'
        const visual = networkVisual(
          id,
          kind,
          iface?.displayName ?? preferences[id]?.customName ?? id
        )
        return { id, name: visual.name, color: visual.solid, total }
      })
  }, [days, byDay, interfaces, preferences, networkVisual])

  const dayTotals = days.map((day) =>
    Object.values(byDay.get(day) ?? {}).reduce((sum, bytes) => sum + bytes, 0)
  )
  const rangeTotal = dayTotals.reduce((sum, bytes) => sum + bytes, 0)
  const today = dayTotals[dayTotals.length - 1] ?? 0
  const top = niceMax(Math.max(...dayTotals, 0))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>Data usage</DialogTitle>
          <DialogDescription>What each network downloaded, day by day.</DialogDescription>
        </DialogHeader>

        <div className="flex items-end gap-8">
          <div>
            <div className="text-[11.5px] font-semibold text-muted-foreground">Today</div>
            <div className="mt-1 text-[26px] leading-none font-semibold tabular-nums">
              {formatBytes(today)}
            </div>
          </div>
          <div>
            <div className="text-[11.5px] font-semibold text-muted-foreground">
              Last {range} days
            </div>
            <div className="mt-1 text-[26px] leading-none font-semibold tabular-nums">
              {formatBytes(rangeTotal)}
            </div>
          </div>
          <div className="flex-1" />
          <ToggleGroup
            aria-label="Range"
            value={[String(range)]}
            onValueChange={(values) => {
              if (values[0] !== undefined) setRange(Number(values[0]) as Range)
            }}
            size="sm"
            className="rounded-full border-[0.5px] border-border p-0.5"
          >
            {RANGES.map((value) => (
              <ToggleGroupItem
                key={value}
                value={String(value)}
                className="h-6 rounded-full px-2.5 text-[12px] font-medium text-muted-foreground aria-pressed:bg-[var(--control-bg)] aria-pressed:text-foreground aria-pressed:shadow-sm"
              >
                {value} days
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>

        {history === null ? (
          <div style={{ height: CHART_HEIGHT + TOP_PAD + 18 }} />
        ) : rangeTotal === 0 ? (
          <div
            className="flex items-center justify-center text-[13px] text-muted-foreground"
            style={{ height: CHART_HEIGHT + TOP_PAD + 18 }}
          >
            Nothing downloaded in the last {range} days.
          </div>
        ) : (
          <div ref={measure} className="relative" onMouseLeave={() => setHovered(null)}>
            <svg
              width={width}
              height={CHART_HEIGHT + TOP_PAD + 6}
              role="img"
              aria-label={`Bytes downloaded per day over the last ${range} days, by network`}
            >
              {[0, 0.5, 1].map((fraction) => {
                const y = TOP_PAD + CHART_HEIGHT - fraction * CHART_HEIGHT + 0.5
                return (
                  <g key={fraction}>
                    <line
                      x1={AXIS_WIDTH}
                      x2={width}
                      y1={y}
                      y2={y}
                      stroke="var(--border-subtle)"
                      strokeWidth={1}
                    />
                    <text
                      x={AXIS_WIDTH - 8}
                      y={y + 3.5}
                      textAnchor="end"
                      className="fill-[var(--text-tertiary)] text-[10px] tabular-nums"
                    >
                      {formatBytes(top * fraction)}
                    </text>
                  </g>
                )
              })}
              <g transform={`translate(${AXIS_WIDTH} ${TOP_PAD})`}>
                <Bars
                  width={Math.max(0, width - AXIS_WIDTH)}
                  days={days}
                  byDay={byDay}
                  series={series}
                  top={top}
                  hovered={hovered}
                  onHover={setHovered}
                />
              </g>
            </svg>
            <div className="flex justify-between pl-14 text-[10.5px] text-[var(--text-tertiary)] tabular-nums">
              <span>{shortDate(days[0])}</span>
              <span>{shortDate(days[Math.floor(days.length / 2)])}</span>
              <span>Today</span>
            </div>
            {hovered !== null && (
              <DayTooltip
                day={days[hovered]}
                bytes={byDay.get(days[hovered]) ?? {}}
                series={series}
                left={AXIS_WIDTH + ((width - AXIS_WIDTH) * (hovered + 0.5)) / days.length}
                flip={hovered > days.length / 2}
              />
            )}
          </div>
        )}

        {series.length > 0 && (
          <ul className="flex flex-col gap-1.5" aria-label="Networks">
            {series.map((entry) => (
              <li key={entry.id} className="flex items-center gap-2.5 text-[13px]">
                <span
                  aria-hidden
                  className="size-2.5 shrink-0 rounded-[3px]"
                  style={{ background: entry.color }}
                />
                <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                <span className="text-muted-foreground tabular-nums">
                  {Math.round((entry.total / rangeTotal) * 100)}%
                </span>
                <span className="w-20 text-right font-medium tabular-nums">
                  {formatBytes(entry.total)}
                </span>
              </li>
            ))}
          </ul>
        )}

        {series.length > 0 && (
          <table className="sr-only">
            <caption>Bytes downloaded per day</caption>
            <thead>
              <tr>
                <th scope="col">Day</th>
                {series.map((entry) => (
                  <th key={entry.id} scope="col">
                    {entry.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {days.map((day) => (
                <tr key={day}>
                  <th scope="row">{shortDate(day)}</th>
                  {series.map((entry) => (
                    <td key={entry.id}>{formatBytes(byDay.get(day)?.[entry.id] ?? 0)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** One column per day, its networks stacked biggest-first from the baseline, with a gap of
 * surface between segments and between columns, and a rounded top on each column. */
function Bars({
  width,
  days,
  byDay,
  series,
  top,
  hovered,
  onHover
}: {
  width: number
  days: string[]
  byDay: Map<string, Record<string, number>>
  series: Series[]
  top: number
  hovered: number | null
  onHover: (index: number) => void
}): React.JSX.Element {
  const slot = width / days.length
  const barWidth = Math.max(1, slot - GAP)
  return (
    <>
      {days.map((day, index) => {
        const bytes = byDay.get(day) ?? {}
        const x = index * slot + GAP / 2
        let y = CHART_HEIGHT
        const segments = series
          .map((entry) => ({ entry, value: bytes[entry.id] ?? 0 }))
          .filter(({ value }) => value > 0)
          .map(({ entry, value }, position) => {
            const gap = position > 0 ? GAP : 0
            const height = Math.max(1, (value / top) * CHART_HEIGHT - gap)
            y -= height + gap
            return { entry, y, height }
          })
        const columnTop = segments.length ? segments[segments.length - 1].y : CHART_HEIGHT
        const dimmed = hovered !== null && hovered !== index
        return (
          <g key={day} opacity={dimmed ? 0.45 : 1}>
            <clipPath id={`usage-bar-${index}`}>
              <rect
                x={x}
                y={columnTop}
                width={barWidth}
                height={CHART_HEIGHT - columnTop + 4}
                rx={Math.min(4, barWidth / 2)}
              />
            </clipPath>
            <g clipPath={`url(#usage-bar-${index})`}>
              {segments.map((segment) => (
                <rect
                  key={segment.entry.id}
                  x={x}
                  y={segment.y}
                  width={barWidth}
                  height={segment.height}
                  fill={segment.entry.color}
                />
              ))}
            </g>
            {/* The whole column height, so a thin or empty day is still easy to hover. */}
            <rect
              x={index * slot}
              width={slot}
              height={CHART_HEIGHT}
              fill="transparent"
              onMouseEnter={() => onHover(index)}
            />
          </g>
        )
      })}
    </>
  )
}

function DayTooltip({
  day,
  bytes,
  series,
  left,
  flip
}: {
  day: string
  bytes: Record<string, number>
  series: Series[]
  left: number
  flip: boolean
}): React.JSX.Element {
  const total = Object.values(bytes).reduce((sum, value) => sum + value, 0)
  return (
    <div
      className="pointer-events-none absolute top-0 z-10 flex min-w-[170px] flex-col gap-1 rounded-[10px] border-[0.5px] border-border bg-popover px-3 py-2 text-[12px] shadow-lg"
      style={{ left, transform: flip ? 'translateX(calc(-100% - 10px))' : 'translateX(10px)' }}
    >
      <div className="font-semibold">{shortDate(day)}</div>
      {series
        .filter((entry) => (bytes[entry.id] ?? 0) > 0)
        .map((entry) => (
          <div key={entry.id} className="flex items-center gap-2">
            <span
              aria-hidden
              className="size-2 shrink-0 rounded-[2px]"
              style={{ background: entry.color }}
            />
            <span className="min-w-0 flex-1 truncate text-muted-foreground">{entry.name}</span>
            <span className="tabular-nums">{formatBytes(bytes[entry.id])}</span>
          </div>
        ))}
      <div className="mt-0.5 flex justify-between border-t-[0.5px] border-border pt-1 font-medium">
        <span>Total</span>
        <span className="tabular-nums">{formatBytes(total)}</span>
      </div>
    </div>
  )
}

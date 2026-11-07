'use client'

import { useState } from 'react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ROLLING_GAMES, type AccuracyPoint } from '@/lib/publishedTrackRecord'
import { ChartContainer } from '@/components/viz/ChartContainer'

const dateLabel = (time: number) => new Date(time).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit', timeZone: 'UTC' })
const pct = (n: number) => `${n.toFixed(1)}%`

function PointReadout({ point }: { point: AccuracyPoint }) {
  return <div className="space-y-1 break-words text-sm">
    <p className="font-semibold">{point.from} to {point.to}{point.partial ? ' · partial period' : ''}</p>
    <p>Cumulative: {pct(point.cumulative)} correct · {point.correct} of {point.settled} games</p>
    <p>Recent form: {pct(point.recent)} correct · {point.recentCorrect} of {point.recentSettled} games</p>
    <p className="text-xs text-[var(--text-secondary)]">Recent window: {point.recentFrom} to {point.recentTo}; last {ROLLING_GAMES} settled games, or all available when fewer.</p>
    <p className="text-xs text-[var(--text-secondary)]">This period: {point.periodCorrect} correct of {point.periodSettled} settled. Versions: {point.versions.join(', ')}.</p>
  </div>
}

export function AccuracyTimeline({ points }: { points: AccuracyPoint[] }) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  if (!points.length) return <p className="py-6 text-sm text-[var(--text-secondary)]">Not yet scored. The timeline starts with the first eligible settled game.</p>
  const found = points.findIndex(p => p.key === selectedKey)
  const selected = found >= 0 ? found : points.length - 1
  const point = points[selected]
  const domain = points.length > 1 ? [points[0].time, points.at(-1)!.time] : [point.time - 86400000, point.time + 86400000]
  const move = (index: number) => setSelectedKey(points[Math.max(0, Math.min(points.length - 1, index))].key)
  const inspect = (state: { activeTooltipIndex?: number } | null) => {
    const index = state?.activeTooltipIndex
    if (index !== undefined && Number.isSafeInteger(index) && index >= 0 && index < points.length) move(index)
  }
  return <>
    <p className="mt-2 text-sm text-[var(--text-secondary)]">Game dates in UTC. Solid line: cumulative accuracy. Dashed line: recent form over the last {ROLLING_GAMES} settled games. Dips are part of the record.</p>
    <div className="mt-4" role="img" aria-label="Accuracy timeline, calendar date on the horizontal axis and accuracy from zero to one hundred percent on the vertical axis. The same points are available below.">
      <ChartContainer height={288} lazy={false} label="Loading accuracy timeline">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 10, right: 18, bottom: 16, left: 0 }} onClick={inspect} onMouseDown={inspect}>
          <CartesianGrid vertical={false} stroke="var(--border-color)" />
          <XAxis dataKey="time" type="number" scale="time" domain={domain} tickFormatter={dateLabel} tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }} minTickGap={26} />
          <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={n => `${n}%`} width={43} tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }} />
          <Tooltip content={({ active, payload }) => active && payload?.length ? <div className="max-w-xs rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] p-3"><PointReadout point={payload[0].payload as AccuracyPoint} /></div> : null} />
          <Line name="Cumulative accuracy" type="linear" dataKey="cumulative" stroke="var(--accent-primary)" strokeWidth={2.5} dot={{ r: 3 }} isAnimationActive={false} />
          <Line name={`Recent form, last ${ROLLING_GAMES} games`} type="linear" dataKey="recent" stroke="var(--accent-info)" strokeDasharray="5 4" strokeWidth={2} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
      </ChartContainer>
    </div>
    <div className="grid grid-cols-2 items-center gap-3 sm:flex">
      <button type="button" onClick={() => move(selected - 1)} disabled={selected === 0} className="min-h-11 rounded-lg border border-[var(--border-color)] px-3 text-sm disabled:opacity-50">Previous date</button>
      <label className="order-first col-span-2 min-w-0 flex-1 text-xs sm:order-none">Inspect a date
        <input type="range" min={0} max={points.length - 1} value={selected} onChange={e => move(Number(e.target.value))} aria-label="Inspect timeline point" aria-valuetext={`${point.from} to ${point.to}, ${point.correct} correct of ${point.settled} settled`} className="block h-11 w-full accent-[var(--accent-primary)]" />
      </label>
      <button type="button" onClick={() => move(selected + 1)} disabled={selected === points.length - 1} className="min-h-11 rounded-lg border border-[var(--border-color)] px-3 text-sm disabled:opacity-50">Next date</button>
    </div>
    <div className="mt-3 rounded-lg border border-[var(--border-color)] bg-[var(--background)] p-3" aria-live="polite"><PointReadout point={point} /></div>
    <details className="mt-3">
      <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold text-[var(--accent-info)]">Timeline data table</summary>
      <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Scrollable timeline data"><table className="w-full min-w-[560px] text-left text-xs tabular-nums">
        <caption className="sr-only">Every chart point and its exact count denominators</caption>
        <thead><tr><th scope="col" className="p-2">UTC period</th><th scope="col" className="p-2">Cumulative</th><th scope="col" className="p-2">Recent {ROLLING_GAMES}</th><th scope="col" className="p-2">This period</th></tr></thead>
        <tbody>{points.map(p => <tr key={p.key} className="border-t border-[var(--border-color)]"><th scope="row" className="p-2 font-normal">{p.from}–{p.to}{p.partial ? ' (partial)' : ''}</th><td className="p-2">{p.correct}/{p.settled} · {pct(p.cumulative)}</td><td className="p-2">{p.recentCorrect}/{p.recentSettled} · {pct(p.recent)}</td><td className="p-2">{p.periodCorrect}/{p.periodSettled}</td></tr>)}</tbody>
      </table></div>
    </details>
  </>
}

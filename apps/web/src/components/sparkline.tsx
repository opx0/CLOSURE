// One series, one line. A sparkline draws a single signal over time and never a second series on
// the same axis: putting two signals on one scale would invent a common unit they do not share.
export function Sparkline({
  values,
  width = 132,
  height = 30,
}: {
  values: readonly number[]
  width?: number
  height?: number
}) {
  if (values.length < 2) {
    return <span className="text-[11px] text-quiet">one point — a line needs at least two</span>
  }

  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min
  const pad = 3
  const usableH = height - pad * 2
  const step = (width - pad * 2) / (values.length - 1)

  const y = (value: number) =>
    span === 0 ? height / 2 : pad + usableH * (1 - (value - min) / span)
  const points = values.map((value, index) => `${pad + index * step},${y(value)}`).join(' ')
  const lastX = pad + (values.length - 1) * step
  const lastY = y(values[values.length - 1] ?? min)

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`${values.length} points, from ${min} to ${max}`}
      className="overflow-visible"
    >
      <polyline
        points={points}
        fill="none"
        stroke="var(--color-accent)"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={lastX} cy={lastY} r={2.2} fill="var(--color-accent)" />
    </svg>
  )
}

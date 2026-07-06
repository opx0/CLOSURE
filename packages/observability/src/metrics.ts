export type LabelSet = Readonly<Record<string, string>>

type MetricKind = 'counter' | 'gauge' | 'histogram'

interface Series {
  labels: LabelSet
  value: number
  buckets?: Map<number, number>
  sum?: number
  count?: number
}

interface Metric {
  name: string
  help: string
  kind: MetricKind
  bounds?: readonly number[]
  series: Map<string, Series>
}

const NAME_PATTERN = /^[a-z_][a-z0-9_]*$/

function keyOf(labels: LabelSet): string {
  return Object.keys(labels)
    .sort()
    .map((name) => `${name}=${labels[name] ?? ''}`)
    .join(',')
}

function escapeLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"')
}

function renderLabels(labels: LabelSet, extra?: readonly [string, string]): string {
  const pairs = Object.entries(labels).map(([name, value]) => `${name}="${escapeLabel(value)}"`)
  if (extra !== undefined) pairs.push(`${extra[0]}="${escapeLabel(extra[1])}"`)
  return pairs.length === 0 ? '' : `{${pairs.join(',')}}`
}

export const DEFAULT_BUCKETS: readonly number[] = [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120]

export class MetricsRegistry {
  readonly #metrics = new Map<string, Metric>()

  #metric(name: string, help: string, kind: MetricKind, bounds?: readonly number[]): Metric {
    if (!NAME_PATTERN.test(name)) throw new Error(`metric name ${name} is not a valid identifier`)
    const existing = this.#metrics.get(name)
    if (existing !== undefined) {
      if (existing.kind !== kind) {
        throw new Error(`metric ${name} is already registered as a ${existing.kind}`)
      }
      return existing
    }
    const metric: Metric = {
      name,
      help,
      kind,
      series: new Map(),
      ...(bounds === undefined ? {} : { bounds }),
    }
    this.#metrics.set(name, metric)
    return metric
  }

  #series(metric: Metric, labels: LabelSet): Series {
    const key = keyOf(labels)
    const found = metric.series.get(key)
    if (found !== undefined) return found
    const series: Series =
      metric.kind === 'histogram'
        ? {
            labels,
            value: 0,
            buckets: new Map((metric.bounds ?? DEFAULT_BUCKETS).map((bound) => [bound, 0])),
            sum: 0,
            count: 0,
          }
        : { labels, value: 0 }
    metric.series.set(key, series)
    return series
  }

  counter(name: string, help: string, labels: LabelSet = {}, by = 1): void {
    this.#series(this.#metric(name, help, 'counter'), labels).value += by
  }

  gauge(name: string, help: string, value: number, labels: LabelSet = {}): void {
    this.#series(this.#metric(name, help, 'gauge'), labels).value = value
  }

  observe(
    name: string,
    help: string,
    value: number,
    labels: LabelSet = {},
    bounds: readonly number[] = DEFAULT_BUCKETS,
  ): void {
    const series = this.#series(this.#metric(name, help, 'histogram', bounds), labels)
    series.sum = (series.sum ?? 0) + value
    series.count = (series.count ?? 0) + 1
    for (const bound of series.buckets?.keys() ?? []) {
      if (value <= bound) series.buckets?.set(bound, (series.buckets.get(bound) ?? 0) + 1)
    }
  }

  render(): string {
    const lines: string[] = []
    for (const metric of this.#metrics.values()) {
      lines.push(`# HELP ${metric.name} ${metric.help}`)
      lines.push(`# TYPE ${metric.name} ${metric.kind}`)
      for (const series of metric.series.values()) {
        if (metric.kind !== 'histogram') {
          lines.push(`${metric.name}${renderLabels(series.labels)} ${series.value}`)
          continue
        }
        // Buckets are already cumulative: `observe` increments every bound the value falls under.
        for (const [bound, count] of series.buckets ?? []) {
          lines.push(
            `${metric.name}_bucket${renderLabels(series.labels, ['le', String(bound)])} ${count}`,
          )
        }
        lines.push(
          `${metric.name}_bucket${renderLabels(series.labels, ['le', '+Inf'])} ${series.count ?? 0}`,
        )
        lines.push(`${metric.name}_sum${renderLabels(series.labels)} ${series.sum ?? 0}`)
        lines.push(`${metric.name}_count${renderLabels(series.labels)} ${series.count ?? 0}`)
      }
    }
    return `${lines.join('\n')}\n`
  }

  reset(): void {
    this.#metrics.clear()
  }
}

export const metrics = new MetricsRegistry()

export const MODEL_CALLS = 'closer_model_calls_total'
export const MODEL_TOKENS = 'closer_model_tokens_total'
export const MODEL_COST = 'closer_model_cost_usd_total'
export const MODEL_LATENCY = 'closer_model_latency_seconds'
export const SCHEMA_FAILURES = 'closer_schema_failures_total'
export const JOB_ATTEMPTS = 'closer_job_attempts_total'
export const JOB_DURATION = 'closer_job_duration_seconds'
export const RETRIEVAL_HITS = 'closer_retrieval_hits_total'
export const HTTP_REQUESTS = 'closer_http_requests_total'
export const HTTP_DURATION = 'closer_http_request_seconds'
export const SESSIONS_STARTED = 'closer_sessions_started_total'
export const CEILING_BREACHES = 'closer_ceiling_breaches_total'
export const INJECTION_ATTEMPTS = 'closer_injection_attempts_total'

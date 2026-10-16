import { expect, test } from 'bun:test'
import { MetricsRegistry } from './metrics.ts'

test('counters and gauges render in the Prometheus text format', () => {
  const registry = new MetricsRegistry()
  registry.counter('levelhead_model_calls_total', 'Model calls', { port: 'evaluator' })
  registry.counter('levelhead_model_calls_total', 'Model calls', { port: 'evaluator' })
  registry.gauge('levelhead_sessions_open', 'Open sessions', 3)

  const text = registry.render()
  expect(text).toContain('# TYPE levelhead_model_calls_total counter')
  expect(text).toContain('levelhead_model_calls_total{port="evaluator"} 2')
  expect(text).toContain('levelhead_sessions_open 3')
})

test('a histogram reports cumulative buckets, a sum and a count', () => {
  const registry = new MetricsRegistry()
  registry.observe('levelhead_job_duration_seconds', 'Job duration', 0.3, {}, [0.1, 0.5, 1])
  registry.observe('levelhead_job_duration_seconds', 'Job duration', 0.7, {}, [0.1, 0.5, 1])

  const text = registry.render()
  expect(text).toContain('levelhead_job_duration_seconds_bucket{le="0.1"} 0')
  expect(text).toContain('levelhead_job_duration_seconds_bucket{le="0.5"} 1')
  expect(text).toContain('levelhead_job_duration_seconds_bucket{le="1"} 2')
  expect(text).toContain('levelhead_job_duration_seconds_count 2')
  expect(text).toContain('levelhead_job_duration_seconds_sum 1')
})

// A label value is caller-controlled in principle, so it is escaped rather than trusted; an
// unescaped newline would forge a second metric line.
test('label values are escaped', () => {
  const registry = new MetricsRegistry()
  registry.counter('levelhead_http_requests_total', 'Requests', { route: 'a"b\nc' })

  expect(registry.render()).toContain('route="a\\"b\\nc"')
})

test('reusing a name with a different metric type is refused', () => {
  const registry = new MetricsRegistry()
  registry.counter('levelhead_thing_total', 'Thing')

  expect(() => registry.gauge('levelhead_thing_total', 'Thing', 1)).toThrow(/already registered/)
})

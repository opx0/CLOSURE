export interface TracingOptions {
  serviceName: string
  endpoint: string | undefined
  enabled: boolean
}

export interface TracingHandle {
  shutdown(): Promise<void>
}

const inert: TracingHandle = { shutdown: async () => {} }

// Dynamically imported so the OpenTelemetry SDK is loaded only where it is switched on. The
// production runtime is Node (ADR-002); the dev/test runner is Bun, where the auto-instrumentation
// surface is not verified, and an unconditional top-level import would drag it into every test run.
export async function startTracing(options: TracingOptions): Promise<TracingHandle> {
  if (!options.enabled) return inert

  try {
    const [{ NodeSDK }, { OTLPTraceExporter }, { resourceFromAttributes }, semconv] =
      await Promise.all([
        import('@opentelemetry/sdk-node'),
        import('@opentelemetry/exporter-trace-otlp-http'),
        import('@opentelemetry/resources'),
        import('@opentelemetry/semantic-conventions'),
      ])

    const sdk = new NodeSDK({
      resource: resourceFromAttributes({
        [semconv.ATTR_SERVICE_NAME]: options.serviceName,
      }),
      traceExporter: new OTLPTraceExporter(
        options.endpoint === undefined ? {} : { url: options.endpoint },
      ),
    })
    sdk.start()
    return { shutdown: () => sdk.shutdown() }
  } catch (error) {
    process.stderr.write(
      `tracing disabled: ${error instanceof Error ? error.message : String(error)}\n`,
    )
    return inert
  }
}

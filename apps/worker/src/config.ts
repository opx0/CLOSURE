import { Type, type Static } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'

const IngestSchema = Type.Object({
  INGEST_MAX_FILES: Type.Integer({ minimum: 1, default: 2_000 }),
  INGEST_MAX_TOTAL_BYTES: Type.Integer({ minimum: 1, default: 20 * 1024 * 1024 }),
  INGEST_MAX_FILE_BYTES: Type.Integer({ minimum: 1, default: 512 * 1024 }),
  INGEST_MAX_DEPTH: Type.Integer({ minimum: 1, default: 12 }),
  INGEST_TIMEOUT_MS: Type.Integer({ minimum: 1_000, default: 60_000 }),
  INGEST_HEAP_MB: Type.Integer({ minimum: 128, default: 1_024 }),
})

export type IngestConfig = Static<typeof IngestSchema>

export const INGEST_DEFAULTS: IngestConfig = Value.Parse(IngestSchema, {})

const ConfigSchema = Type.Object({
  NODE_ENV: Type.Union(
    [Type.Literal('development'), Type.Literal('test'), Type.Literal('production')],
    { default: 'development' },
  ),
  DATABASE_URL: Type.String({ minLength: 1 }),
  LOG_LEVEL: Type.Union(
    [
      Type.Literal('fatal'),
      Type.Literal('error'),
      Type.Literal('warn'),
      Type.Literal('info'),
      Type.Literal('debug'),
      Type.Literal('trace'),
    ],
    { default: 'info' },
  ),
  LEVELHEAD_EVENT_DIR: Type.String({ minLength: 1, default: '.levelhead/events' }),
  LEVELHEAD_EXPORT_DIR: Type.String({ minLength: 1, default: '.levelhead/exports' }),
  WORKER_NAME: Type.String({ minLength: 1, default: 'worker-1' }),
  WORKER_POLL_MS: Type.Integer({ minimum: 100, default: 1_000 }),
  WORKER_LEASE_SECONDS: Type.Integer({ minimum: 5, default: 120 }),
  WORKER_BATCH: Type.Integer({ minimum: 1, maximum: 20, default: 1 }),
  WORKER_METRICS_PORT: Type.Integer({ minimum: 0, maximum: 65535, default: 0 }),
  ...IngestSchema.properties,
  SNAPSHOT_RETENTION_DAYS: Type.Integer({ minimum: 1, default: 90 }),
  // Off unless someone turns it on, and a configured provider alone is not enough. Every nudge is
  // rendered in full and delivered nowhere until both this and the channel's credentials are set.
  NUDGE_DELIVERY_ARMED: Type.Boolean({ default: false }),
  RESEND_API_KEY: Type.Optional(Type.String({ minLength: 1 })),
  NUDGE_EMAIL_FROM: Type.Optional(Type.String({ minLength: 1 })),
  TWILIO_ACCOUNT_SID: Type.Optional(Type.String({ minLength: 1 })),
  TWILIO_AUTH_TOKEN: Type.Optional(Type.String({ minLength: 1 })),
  TWILIO_FROM_NUMBER: Type.Optional(Type.String({ minLength: 1 })),
  WHATSAPP_PHONE_NUMBER_ID: Type.Optional(Type.String({ minLength: 1 })),
  WHATSAPP_ACCESS_TOKEN: Type.Optional(Type.String({ minLength: 1 })),
  WHATSAPP_GRAPH_VERSION: Type.String({ minLength: 1, default: 'v23.0' }),
  OTEL_ENABLED: Type.Boolean({ default: false }),
  OTEL_EXPORTER_OTLP_ENDPOINT: Type.Optional(Type.String({ minLength: 1 })),
})

export type WorkerConfig = Static<typeof ConfigSchema>

export function loadWorkerConfig(
  source: Record<string, string | undefined> = process.env,
): WorkerConfig {
  const withDefaults = Value.Default(ConfigSchema, { ...source })
  const coerced = Value.Convert(ConfigSchema, withDefaults)
  if (Value.Check(ConfigSchema, coerced)) return coerced

  const problems = [...Value.Errors(ConfigSchema, coerced)]
    .map((error) => `  ${error.path || '/'}: ${error.message}`)
    .join('\n')
  process.stderr.write(`Invalid worker configuration:\n${problems}\n`)
  process.exit(1)
}

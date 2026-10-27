import { Type, type Static } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'

const LogLevel = Type.Union(
  [
    Type.Literal('fatal'),
    Type.Literal('error'),
    Type.Literal('warn'),
    Type.Literal('info'),
    Type.Literal('debug'),
    Type.Literal('trace'),
  ],
  { default: 'info' },
)

const ConfigSchema = Type.Object({
  NODE_ENV: Type.Union(
    [Type.Literal('development'), Type.Literal('test'), Type.Literal('production')],
    { default: 'development' },
  ),
  PORT: Type.Integer({ minimum: 1, maximum: 65535, default: 3001 }),
  LEVELHEAD_HOST: Type.Optional(Type.String({ minLength: 1 })),
  LOG_LEVEL: LogLevel,
  // Same JSONL directory the CLI writes, so both callers read one event log.
  LEVELHEAD_EVENT_DIR: Type.String({ minLength: 1, default: '.levelhead/events' }),
  LEVELHEAD_EXPORT_DIR: Type.String({ minLength: 1, default: '.levelhead/exports' }),
  LEVELHEAD_STORE: Type.Union([Type.Literal('jsonl'), Type.Literal('postgres')], {
    default: 'jsonl',
  }),
  DATABASE_URL: Type.Optional(Type.String({ minLength: 1 })),
  SESSION_TOKEN_CEILING: Type.Integer({ minimum: 1, default: 120_000 }),
  SESSION_COST_CEILING_USD: Type.Number({ minimum: 0, default: 2 }),
  MODEL_CALLS_PER_TURN_CEILING: Type.Integer({ minimum: 1, default: 3 }),
  // `owner:token` pairs, comma-separated. Empty means the server is single-owner and local: every
  // request is the local developer. ADR-023 — the boundary exists either way; this is what fills it.
  LEVELHEAD_API_TOKENS: Type.String({ default: '' }),
  LEVELHEAD_CORS_ORIGIN: Type.String({ default: '' }),
  LEVELHEAD_RATE_LIMIT_PER_MINUTE: Type.Integer({ minimum: 1, default: 120 }),
  LEVELHEAD_MAX_BODY_BYTES: Type.Integer({ minimum: 1024, default: 256 * 1024 }),
  // A showcase instance runs on a synthetic résumé and refuses to keep anyone's real material.
  LEVELHEAD_DEMO_MODE: Type.Boolean({ default: false }),
  LEVELHEAD_PREVIEW_MODE: Type.Boolean({ default: false }),
  LEVELHEAD_WEB_DIST: Type.String({ minLength: 1, default: 'apps/web/dist' }),
  SNAPSHOT_RETENTION_DAYS: Type.Integer({ minimum: 1, default: 90 }),
  OTEL_ENABLED: Type.Boolean({ default: false }),
  OTEL_EXPORTER_OTLP_ENDPOINT: Type.Optional(Type.String({ minLength: 1 })),
})

export type Config = Static<typeof ConfigSchema>

export function loadConfig(source: Record<string, string | undefined> = process.env): Config {
  const withDefaults = Value.Default(ConfigSchema, { ...source })
  const coerced = Value.Convert(ConfigSchema, withDefaults)
  if (Value.Check(ConfigSchema, coerced)) {
    if (coerced.LEVELHEAD_STORE === 'postgres' && coerced.DATABASE_URL === undefined) {
      process.stderr.write('LEVELHEAD_STORE=postgres needs DATABASE_URL.\n')
      process.exit(1)
    }
    return coerced
  }

  const problems = [...Value.Errors(ConfigSchema, coerced)]
    .map((error) => `  ${error.path || '/'}: ${error.message}`)
    .join('\n')
  process.stderr.write(`Invalid environment configuration:\n${problems}\n`)
  process.exit(1)
}

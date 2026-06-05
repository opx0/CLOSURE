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
  LOG_LEVEL: LogLevel,
  DATABASE_URL: Type.String({ minLength: 1 }),
  SESSION_TOKEN_CEILING: Type.Integer({ minimum: 1, default: 120_000 }),
  SESSION_COST_CEILING_USD: Type.Number({ minimum: 0, default: 2 }),
  MODEL_CALLS_PER_TURN_CEILING: Type.Integer({ minimum: 1, default: 3 }),
})

export type Config = Static<typeof ConfigSchema>

export function loadConfig(source: Record<string, string | undefined> = process.env): Config {
  // Env values arrive as strings: fill defaults, coerce to the declared types, then validate.
  const withDefaults = Value.Default(ConfigSchema, { ...source })
  const coerced = Value.Convert(ConfigSchema, withDefaults)
  if (Value.Check(ConfigSchema, coerced)) return coerced

  const problems = [...Value.Errors(ConfigSchema, coerced)]
    .map((error) => `  ${error.path || '/'}: ${error.message}`)
    .join('\n')
  process.stderr.write(`Invalid environment configuration:\n${problems}\n`)
  process.exit(1)
}

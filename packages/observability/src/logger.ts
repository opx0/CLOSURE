import { pino, type Logger as PinoLogger } from 'pino'
import { redactFields, type Scalar } from './redact.ts'

export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace'

export interface LogFields {
  [key: string]: Scalar
}

export interface Logger {
  child(fields: LogFields): Logger
  log(level: LogLevel, message: string, fields?: LogFields): void
}

class PinoAdapter implements Logger {
  constructor(private readonly inner: PinoLogger) {}

  child(fields: LogFields): Logger {
    return new PinoAdapter(this.inner.child(redactFields(fields)))
  }

  log(level: LogLevel, message: string, fields: LogFields = {}): void {
    this.inner[level](redactFields(fields), message)
  }
}

export interface LoggerOptions {
  level: LogLevel
  service: string
  pretty?: boolean
}

export function createLogger(options: LoggerOptions): Logger {
  return new PinoAdapter(
    pino({
      level: options.level,
      base: { service: options.service },
      // A second line of defence: even a field name this build never anticipated is redacted if it
      // lands under one of these paths.
      redact: {
        paths: ['req.headers.authorization', 'req.headers.cookie', 'payload', 'body'],
        censor: '[redacted]',
      },
      ...(options.pretty === true
        ? { transport: { target: 'pino/file', options: { destination: 2 } } }
        : {}),
    }),
  )
}

export const silentLogger: Logger = {
  child: () => silentLogger,
  log: () => {},
}

export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace'

export interface LogFields {
  [key: string]: string | number | boolean | null | undefined
}

export interface Logger {
  child(fields: LogFields): Logger
  log(level: LogLevel, message: string, fields?: LogFields): void
}

export const silentLogger: Logger = {
  child: () => silentLogger,
  log: () => {},
}

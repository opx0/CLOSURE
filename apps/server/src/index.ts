import { loadConfig } from './config.ts'
import { buildApp } from './app.ts'

const config = loadConfig()
const app = await buildApp(config)

try {
  await app.listen({ port: config.PORT, host: '0.0.0.0' })
} catch (error) {
  app.log.error(error)
  process.exit(1)
}

import net from 'node:net'
import dns from 'node:dns'
import { forbidNetwork } from './no-network.ts'

forbidNetwork()

async function blocked(what: string, attempt: () => unknown): Promise<void> {
  try {
    await attempt()
    process.stdout.write(`${what}:allowed\n`)
  } catch (error) {
    process.stdout.write(
      `${what}:${error instanceof Error && error.name === 'NetworkDuringParse' ? 'blocked' : 'other'}\n`,
    )
  }
}

await blocked('fetch', () => fetch('http://127.0.0.1:9/'))
await blocked('tcp', () => net.connect(9, '127.0.0.1'))
await blocked('dns', () => dns.promises.lookup('example.invalid'))

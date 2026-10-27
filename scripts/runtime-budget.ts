import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { availableParallelism, freemem, platform, totalmem } from 'node:os'

export function byteLimit(value: string): number | null {
  const parsed = Number(value.trim())
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

export function memoryBudget(
  total: number,
  available: number,
  limit: number | null,
  used: number | null,
) {
  return {
    hostTotalBytes: total,
    hostAvailableBytes: available,
    containerLimitBytes: limit,
    containerUsedBytes: used,
    effectiveTotalBytes: Math.min(total, limit ?? total),
    effectiveAvailableBytes:
      limit === null
        ? available
        : used === null
          ? null
          : Math.min(available, Math.max(0, limit - used)),
  }
}

async function read(path: string): Promise<string> {
  return readFile(path, 'utf8').catch(() => '')
}

async function command(file: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: 2_000, maxBuffer: 16_384 }, (error, stdout) => {
      resolve(error === null ? stdout.trim() : null)
    })
  })
}

export async function runtimeBudget() {
  const [meminfo, max, current, node, bun, git, gpu] = await Promise.all([
    read('/proc/meminfo'),
    read('/sys/fs/cgroup/memory.max'),
    read('/sys/fs/cgroup/memory.current'),
    command('node', ['--version']),
    command('bun', ['--version']),
    command('git', ['--version']),
    command('nvidia-smi', [
      '--query-gpu=name,memory.total,memory.free',
      '--format=csv,noheader,nounits',
    ]),
  ])
  const availableKb = /^MemAvailable:\s+(\d+)\s+kB$/m.exec(meminfo)?.[1]
  return {
    scope: 'current execution environment; not a measurement of another machine',
    measuredAt: new Date().toISOString(),
    platform: platform(),
    cpuThreads: availableParallelism(),
    memory: memoryBudget(
      totalmem(),
      availableKb ? Number(availableKb) * 1024 : freemem(),
      byteLimit(max),
      byteLimit(current),
    ),
    tools: { node, bun, git },
    nvidia:
      gpu === null ? { available: false } : { available: true, nameTotalFreeMiB: gpu.split('\n') },
    inference: { measured: false, reason: 'No model loaded, downloaded or invoked by this probe.' },
  }
}

if (import.meta.main) console.log(JSON.stringify(await runtimeBudget(), null, 2))

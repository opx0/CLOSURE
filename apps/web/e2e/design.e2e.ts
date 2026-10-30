import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'

async function start(root: string, port = 0): Promise<{ process: ChildProcess; port: number }> {
  const child = spawn('bun', ['run', 'apps/server/src/testing/recovery-server.ts'], {
    env: { ...process.env, RECOVERY_EVENT_DIR: root, RECOVERY_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  try {
    const ready = await new Promise<number>((resolve, reject) => {
      let stderr = ''
      const timeout = setTimeout(
        () => reject(new Error(`Restart fixture did not start: ${stderr.slice(-1000)}`)),
        10000,
      )
      child.stderr?.on('data', (data) => {
        stderr += String(data)
      })
      child.once('error', (error) => {
        clearTimeout(timeout)
        reject(error)
      })
      child.once('exit', (code) => {
        clearTimeout(timeout)
        reject(new Error(`Restart fixture exited: ${code}`))
      })
      child.stdout?.on('data', (data) => {
        const match = /RECOVERY_PORT=(\d+)/.exec(String(data))
        if (match) {
          clearTimeout(timeout)
          resolve(Number(match[1]))
        }
      })
    })
    return { process: child, port: ready }
  } catch (error) {
    child.kill('SIGKILL')
    throw error
  }
}

async function stop(child: ChildProcess): Promise<void> {
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => child.kill('SIGKILL'), 3000)
    child.once('exit', () => {
      clearTimeout(timeout)
      resolve()
    })
    child.kill('SIGTERM')
  })
}

test('a changed design constraint can be rehearsed and inspected beside reopened evidence', async ({
  page,
}) => {
  const root = await mkdtemp(join(tmpdir(), 'levelhead-design-'))
  let server: Awaited<ReturnType<typeof start>> | undefined
  try {
    server = await start(root)
    const origin = `http://127.0.0.1:${server.port}`
    await page.goto(`${origin}/app/designs`)
    await page.getByRole('textbox', { name: 'Scenario title' }).fill('Notification service')
    await page
      .getByRole('textbox', { name: 'Requirements' })
      .fill('Retry delivery without duplicate notifications.')
    await page.getByRole('textbox', { name: 'Capacity estimates' }).fill('100 requests per second.')
    await page.getByRole('textbox', { name: 'API and boundaries' }).fill('POST /notifications')
    await page
      .getByRole('textbox', { name: 'Data model' })
      .fill('notification(id, recipient, state)')
    await page
      .getByRole('textbox', { name: 'Mermaid source (text only)' })
      .fill('flowchart LR\n API --> Queue')
    await page
      .getByRole('textbox', { name: 'Current constraint to test' })
      .fill('One region is enough.')
    await page.getByRole('button', { name: 'Save design' }).click()
    await expect(page.getByText('Notification service · revision 1')).toBeVisible()
    await page.getByRole('button', { name: 'Edit design' }).click()
    await page
      .getByRole('textbox', { name: 'Current constraint to test' })
      .fill('Survive the loss of one region.')
    await page.getByRole('button', { name: 'Save new revision' }).click()
    await expect(page.getByText('Notification service · revision 2')).toBeVisible()
    await page.getByText('Earlier revisions').click()
    await expect(page.getByText('One region is enough.')).toBeVisible()
    await page.getByRole('link', { name: 'Rehearse this revision' }).click()
    await page.getByRole('button', { name: 'Start the interview' }).click()
    await page
      .getByPlaceholder('Answer in your own words')
      .fill(
        'I would make notifications idempotent by request key, persist the state, and replay the queue after regional failover.',
      )
    await page.getByRole('button', { name: 'Send answer' }).click()
    await page.getByRole('link', { name: 'Read the debrief' }).click()
    await expect(page.getByText('Design used · Notification service · revision 2')).toBeVisible()
    await page.getByText('Design used · Notification service · revision 2').click()
    await expect(page.getByText('Survive the loss of one region.')).toBeVisible()

    const port = server.port
    await stop(server.process)
    server = await start(root, port)

    await page.reload()
    await expect(page.getByText('Design used · Notification service · revision 2')).toBeVisible()
  } finally {
    if (server) await stop(server.process)
    await rm(root, { recursive: true, force: true })
  }
})

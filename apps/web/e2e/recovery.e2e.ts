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
      let stdout = '',
        stderr = ''
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
        stdout += String(data)
        const match = /RECOVERY_PORT=(\d+)/.exec(stdout)
        if (match) {
          clearTimeout(timeout)
          resolve(Number(match[1]))
        }
      })
    })
    return { process: child, port: ready }
  } catch (error) {
    await stop(child)
    throw error
  }
}

async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => child.kill('SIGKILL'), 3000)
    child.once('exit', () => {
      clearTimeout(timeout)
      resolve()
    })
    child.kill('SIGTERM')
  })
}

test('a server restart preserves the draft and ends an interrupted Simulation without a retry/navigation loop', async ({
  page,
}) => {
  const root = await mkdtemp(join(tmpdir(), 'levelhead-browser-restart-'))
  let server: Awaited<ReturnType<typeof start>> | undefined
  try {
    server = await start(root)
    const origin = `http://127.0.0.1:${server.port}`
    const text = 'A B-tree stores ordered keys and updates them on inserts.'
    const started = await page.request.post(`${origin}/sessions`, {
      data: {
        mode: 'simulation',
        topicIds: ['dbms.indexes'],
        level: 'junior',
        turnsPerRound: 2,
        drill: false,
      },
    })
    expect(started.status()).toBe(201)
    const id = (await started.json()).sessionId
    const accepted = await page.request.post(`${origin}/sessions/${id}/answers`, { data: { text } })
    expect((await accepted.json()).findings).toEqual([])
    const original = await (await page.request.get(`${origin}/sessions/${id}/events`)).json()
    await page.goto(`${origin}/app/session?id=${id}`)
    const draft = 'My unsent answer should remain visible after the server restarts.'
    await page.getByPlaceholder('Answer in your own words').fill(draft)
    const port = server.port
    await stop(server.process)
    server = await start(root, port)
    let submissions = 0
    page.on('request', (request) => {
      if (request.url().endsWith(`/sessions/${id}/answers`) && request.method() === 'POST')
        submissions++
    })
    await page.getByRole('button', { name: 'Send answer', exact: true }).click()
    await expect(page.getByText('This interview was interrupted', { exact: true })).toBeVisible()
    await expect(page.getByLabel('Unsent answer draft')).toHaveValue(draft)
    await expect(page.getByRole('button', { name: 'Send answer', exact: true })).toHaveCount(0)
    expect(submissions).toBe(1)
    await page.getByRole('button', { name: 'End interrupted interview', exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/app/debrief\\?id=${id}$`))
    await expect(page.getByRole('heading', { name: 'Debrief', exact: true })).toBeVisible()
    const saved = await (await page.request.get(`${origin}/sessions/${id}`)).json()
    expect(saved.availability).toBe('closed')
    expect(
      saved.transcript
        .filter((turn: { role: string }) => turn.role === 'candidate')
        .map((turn: { text: string }) => turn.text),
    ).toEqual([text])
    const events = await (await page.request.get(`${origin}/sessions/${id}/events`)).json()
    expect(events.slice(0, original.length)).toEqual(original)
    expect(events.length).toBe(original.length + 1)
    await page.goto(`${origin}/app/history`)
    await expect(page.getByRole('link', { name: 'Continue interview', exact: true })).toHaveCount(0)
    await page.getByRole('link', { name: 'View debrief', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Debrief', exact: true })).toBeVisible()
  } finally {
    if (server) await stop(server.process)
    await rm(root, { recursive: true, force: true })
  }
})

test('a timed two-round Simulation survives page reload and reopens after server restart', async ({
  page,
}) => {
  const root = await mkdtemp(join(tmpdir(), 'levelhead-timed-browser-'))
  let server: Awaited<ReturnType<typeof start>> | undefined
  try {
    server = await start(root)
    const origin = `http://127.0.0.1:${server.port}`
    const answer = 'A B-tree stores ordered keys and updates them on inserts.'
    const started = await page.request.post(`${origin}/sessions`, {
      data: {
        mode: 'simulation',
        rounds: ['cs_fundamentals', 'problem_solving'],
        turnsPerRound: 1,
        drill: false,
        timedMock: { answerSeconds: 90 },
      },
    })
    expect(started.status()).toBe(201)
    const id = (await started.json()).sessionId as string
    await page.goto(`${origin}/app/session?id=${id}`)
    await expect(page.getByText('Round 1 of 2 · CS fundamentals')).toBeVisible()
    await expect(page.getByRole('timer')).toContainText('seconds left')
    await page.getByPlaceholder('Answer in your own words').fill(answer)
    await page.getByRole('button', { name: 'Send answer' }).click()
    await expect(page.getByText('Round 2 of 2 · Problem solving')).toBeVisible()
    await expect(page.getByRole('timer')).toContainText('seconds left')
    await page.reload()
    await expect(page.getByText('Round 2 of 2 · Problem solving')).toBeVisible()
    await expect(page.getByPlaceholder('Answer in your own words')).toBeVisible()
    await expect(page.getByRole('timer')).toContainText('seconds left')
    await page.getByPlaceholder('Answer in your own words').fill(answer)
    await page.getByRole('button', { name: 'Send answer' }).click()
    await expect(page.getByText('Interview complete')).toBeVisible()
    const port = server.port
    await stop(server.process)
    server = await start(root, port)
    await page.reload()
    await expect(page.getByText('Interview complete')).toBeVisible()
    await expect(page.getByText('Round 1 of 2 · CS fundamentals')).toBeVisible()
    await expect(page.getByText('Round 2 of 2 · Problem solving')).toBeVisible()
    const saved = await (await page.request.get(`${origin}/sessions/${id}`)).json()
    expect(saved.availability).toBe('closed')
    expect(saved.session.timing).toEqual({ answerSeconds: 90, turnsPerRound: 1 })
    expect(saved.closed.reason).toBe('turns')
    expect(saved.findings).toHaveLength(2)
  } finally {
    if (server) await stop(server.process)
    await rm(root, { recursive: true, force: true })
  }
})

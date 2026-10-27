import { execFileSync, spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'

const RESUME_LINE = 'Built a durable job queue on PostgreSQL'
const RESUME = `${RESUME_LINE} processing ~10k jobs/day.`
const ANSWER = 'We leased each job for thirty seconds. I do not think we handled double completion.'
const CITED = 'I do not think we handled double completion'

const TOPIC_ANSWER =
  'An index keeps the keys sorted in a B-tree, so a lookup walks a few pages instead of scanning every row. I am not sure what it costs when the table mostly takes writes.'
const TOPIC_CITED = 'I am not sure what it costs when the table mostly takes writes'

const WALKTHROUGH_ANSWER =
  'It takes the first job whose lease has run out, stamps the worker and a fresh lease, and counts the attempt. Nothing stops two workers from taking the same job at once.'
const WALKTHROUGH_CITED = 'Nothing stops two workers from taking the same job at once'

const CLAIM_JOB = 'export function claimJob(worker: string, jobs: Job[]): Job | null {'

const REPO_FILES: Record<string, string> = {
  'src/queue.ts': [
    "import type { Job } from './types.ts'",
    '',
    'const LEASE_MS = 30_000',
    '',
    CLAIM_JOB,
    '  const job = jobs.find((candidate) => candidate.leasedUntil < Date.now())',
    '  if (job === undefined) return null',
    '  job.worker = worker',
    '  job.leasedUntil = Date.now() + LEASE_MS',
    '  job.attempts += 1',
    '  return job',
    '}',
    '',
  ].join('\n'),
  'src/format.ts': [
    'export function formatDuration(ms: number): string {',
    '  if (ms < 1_000) return `${ms} ms`',
    '  return `${(ms / 1_000).toFixed(1)} s`',
    '}',
    '',
  ].join('\n'),
}

// A readiness number would show up as one of these; the page may say the word "score" only to
// promise there is none.
const SCORE_LIKE = /\b\d{1,3}\s*%|\b\d{1,3}\s*\/\s*(?:10|100)\b|\bgrade\b/i

function makeRepository(): string {
  const dir = mkdtempSync(join(tmpdir(), 'levelhead-e2e-'))
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' })
  git('init', '-q', '-b', 'main')
  for (const [path, content] of Object.entries(REPO_FILES)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), content)
  }
  git('add', '-A')
  git(
    '-c',
    'user.email=e2e@levelhead.invalid',
    '-c',
    'user.name=Levelhead E2E',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-q',
    '-m',
    'first',
  )
  return dir
}

// Taken at the document's full height rather than with `fullPage`, which would leave the sticky
// sidebar stranded wherever the page happened to be scrolled.
async function shot(page: Page, name: string, hover?: Locator): Promise<void> {
  const dir = process.env.SHOTS_DIR
  if (dir === undefined || dir === '') return
  mkdirSync(dir, { recursive: true })
  const viewport = page.viewportSize() ?? { width: 1280, height: 720 }
  const height = await page.evaluate(() => document.documentElement.scrollHeight)
  await page.setViewportSize({ width: viewport.width, height })
  if (hover !== undefined) await hover.hover()
  await page.screenshot({ path: join(dir, `${name}.png`), animations: 'disabled' })
  await page.setViewportSize(viewport)
}

// One server and one store behind every test: the résumé journey confirms the claim the
// walkthrough links code to, and the ledger reads the gap the interview opened.
test.describe.configure({ mode: 'serial' })

test('an interview the interviewer leads: a topic question, an answer, and a finding that quotes it', async ({
  page,
}) => {
  await page.goto('/app/')
  await expect(page.getByRole('heading', { name: 'Prepare', exact: true })).toBeVisible()
  await shot(page, 'home')

  await page.getByRole('link', { name: 'Start an interview' }).click()
  await page.getByRole('button', { name: /^Backend engineer/ }).click()
  await expect(page.getByRole('button', { name: /^Backend engineer/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(page.getByRole('button', { name: /^CS fundamentals/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(page.getByRole('button', { name: 'junior · new grad / intern' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await shot(page, 'interview-setup')

  await page.getByRole('button', { name: 'Start the interview' }).click()

  // Code chose the topic and the action; the model only phrased the sentence.
  await expect(page.getByText('DBMS · Database indexes', { exact: true })).toBeVisible()
  await expect(page.getByText('probe mechanism')).toBeVisible()
  await expect(
    page.getByText('Explain how an index speeds up a lookup and what it costs on writes.'),
  ).toBeVisible()

  await page.getByPlaceholder('Answer in your own words').fill(TOPIC_ANSWER)
  await page.getByRole('button', { name: 'Send answer' }).click()

  const finding = page.getByText('mechanism — short of the junior anchor')
  await expect(finding).toBeVisible()
  await expect(
    page
      .getByRole('listitem')
      .filter({ hasText: TOPIC_ANSWER })
      .getByText('mechanism — short of the junior anchor'),
  ).toBeVisible()
  await expect(page.getByRole('article').getByText(TOPIC_CITED, { exact: true })).toBeVisible()
  await expect(page.getByText(/confidence (high|medium|low) · 0\.\d+/)).toBeVisible()

  await finding.hover()
  await expect(page.locator('mark', { hasText: TOPIC_CITED })).toBeVisible()

  await expect(page.getByText('There is no score.', { exact: false })).toBeVisible()
  await expect(page.getByText(SCORE_LIKE)).toHaveCount(0)
  await shot(page, 'topic-question', finding)

  await page.reload()
  await expect(page.getByText('DBMS · Database indexes', { exact: true })).toHaveCount(2)
  await expect(page.getByRole('article').getByText(TOPIC_CITED, { exact: true })).toBeVisible()
  await expect(page.getByPlaceholder('Answer in your own words')).toBeVisible()
})

test('a résumé claim is confirmed, cross-questioned, and judged with the candidate’s own words cited', async ({
  page,
}) => {
  await page.goto('/app/claims')
  await expect(page).toHaveURL(/\/app\/resume$/)
  await expect(page.getByText('Nothing extracted yet', { exact: false })).toBeVisible()

  await page.getByRole('textbox', { name: 'Your résumé' }).fill(RESUME)
  await page.getByRole('button', { name: 'Extract claims' }).click()

  // Nothing starts confirmed: the claim set is the candidate's.
  const claim = page.getByRole('checkbox').first()
  await expect(claim).toBeVisible()
  await expect(claim).not.toBeChecked()
  await expect(
    page.getByText('built a durable job queue on PostgreSQL', { exact: true }),
  ).toBeVisible()
  await expect(page.getByText(/span \d+–\d+ ·/)).toBeVisible()

  await claim.click()
  await expect(claim).toBeChecked()
  await page.getByRole('link', { name: 'Cross-question my résumé' }).click()

  await expect(page.getByRole('button', { name: /^Project deep dive/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await page.getByRole('button', { name: 'Start the interview' }).click()

  await expect(page.getByText('probe mechanism')).toBeVisible()
  await expect(page.getByText('walk me through how a job is claimed')).toBeVisible()
  await expect(
    page.getByText('Résumé · “built a durable job queue on PostgreSQL”', { exact: true }),
  ).toBeVisible()

  await page.getByPlaceholder('Answer in your own words').fill(ANSWER)
  await page.getByRole('button', { name: 'Send answer' }).click()

  const finding = page.getByText('claim partially supported').first()
  await expect(finding).toBeVisible()
  await expect(page.getByRole('article').getByText(CITED, { exact: true })).toBeVisible()

  await finding.hover()
  await expect(page.locator('mark', { hasText: CITED })).toBeVisible()
  await expect(page.getByText(SCORE_LIKE)).toHaveCount(0)
})

test('a pinned project is walked through file by file, and the résumé feedback names its files', async ({
  page,
}) => {
  const repository = makeRepository()
  try {
    await page.goto('/app/resume')
    await page.getByRole('textbox', { name: 'Path to a local git repository' }).fill(repository)
    await page.getByRole('button', { name: 'Pin project' }).click()
    await expect(page.getByText(repository, { exact: true })).toBeVisible()

    await page.getByRole('link', { name: 'Walk me through this project' }).click()
    await expect(page.getByRole('button', { name: /^Code walkthrough/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await page.getByRole('button', { name: 'Start the interview' }).click()

    await expect(page.getByText('src/queue.ts', { exact: true })).toBeVisible()
    await expect(page.getByText('claimJob', { exact: true })).toBeVisible()
    await expect(page.getByText('lines 5–12')).toBeVisible()
    await expect(page.getByText(CLAIM_JOB, { exact: true })).toBeVisible()
    await expect(
      page.getByText('Walk me through claimJob in src/queue.ts, line by line.'),
    ).toBeVisible()
    await shot(page, 'walkthrough')

    await page.getByPlaceholder('Answer in your own words').fill(WALKTHROUGH_ANSWER)
    await page.getByRole('button', { name: 'Send answer' }).click()
    await expect(
      page.getByRole('article').getByText(WALKTHROUGH_CITED, { exact: true }),
    ).toBeVisible()

    await page.reload()
    await expect(page.getByText('lines 5–12').first()).toBeVisible()
    await expect(page.getByText(CLAIM_JOB, { exact: true }).first()).toBeVisible()

    await page.getByRole('link', { name: 'Résumé & projects' }).click()
    const line = page.getByRole('listitem').filter({ hasText: 'files that share its words' })
    await expect(line.getByText(RESUME_LINE, { exact: true })).toBeVisible()
    await expect(line.getByText('src/queue.ts', { exact: true })).toBeVisible()
    await expect(line.getByText(`you said: “${WALKTHROUGH_CITED}”`).first()).toBeVisible()
    await expect(page.getByText(SCORE_LIKE)).toHaveCount(0)
    await shot(page, 'resume')
  } finally {
    rmSync(repository, { recursive: true, force: true })
  }
})

test('the gap ledger replaces a score, and names a topic gap by its topic', async ({ page }) => {
  await page.goto('/app/ledger')

  await expect(page.getByText('This is what replaces a readiness score')).toBeVisible()
  await expect(page.getByText('DBMS · Database indexes', { exact: true }).first()).toBeVisible()
})

test('the policy the interview runs on is inspectable', async ({ page }) => {
  await page.goto('/app/catalog')

  await expect(page.getByText('Code chooses which of these comes next')).toBeVisible()
  await expect(page.getByText('probe mechanism').first()).toBeVisible()
  await expect(page.getByText('false premise').first()).toBeVisible()
  // Every shipped role says out loud that nobody has measured it.
  await expect(page.getByText(/no agreement has been measured/).first()).toBeVisible()
})

test('behind a durable queue, a pin is handed to a worker, polled, and listed once parsed', async ({
  page,
}) => {
  const origin = 'http://127.0.0.1:3098'
  const repository = makeRepository()
  const server = spawn('bun', ['run', 'apps/server/src/testing/e2e-server.ts'], {
    env: { ...process.env, PORT: '3098', E2E_QUEUE: 'worker' },
    stdio: 'ignore',
  })
  try {
    await expect
      .poll(async () => (await fetch(`${origin}/health`).catch(() => null))?.status, {
        timeout: 30_000,
      })
      .toBe(200)

    await page.goto(`${origin}/app/resume`)
    await page.getByRole('textbox', { name: 'Path to a local git repository' }).fill(repository)
    await page.getByRole('button', { name: 'Pin project' }).click()
    await expect(page.getByText('Queued for a worker', { exact: false })).toBeVisible()

    await expect(page.getByText(repository, { exact: true })).toBeVisible()
    await expect(page.getByText('Queued for a worker', { exact: false })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Walk me through this project' })).toBeVisible()
  } finally {
    server.kill()
    rmSync(repository, { recursive: true, force: true })
  }
})

test('setup survives reload and history without silently replacing a missing project', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/app/session?rounds=cs_fundamentals&mode=coach')
  await page.getByRole('button', { name: /^Backend engineer/ }).click()
  await page.getByRole('button', { name: 'mid' }).click()
  await expect(page).toHaveURL(/level=mid/)
  await page.reload()
  await expect(page.getByRole('button', { name: 'mid' })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'junior · new grad / intern' }).click()
  await page.goBack()
  await expect(page.getByRole('button', { name: 'mid' })).toHaveAttribute('aria-pressed', 'true')
  await page.goto('/app/session?rounds=code_walkthrough&snapshotId=missing-snapshot')
  await expect(page.getByRole('button', { name: 'Start the interview' })).toBeDisabled()
  await expect(
    page.getByText('Select an available pinned project from Prepare or Résumé & projects.', {
      exact: false,
    }),
  ).toBeVisible()
  await page.goto('/app/session?rounds=code_walkthrough')
  await expect(page.getByRole('button', { name: 'Start the interview' })).toBeDisabled()
  await page.goto('/app/session?rounds=cs_fundamentals')
  await expect(page.getByRole('button', { name: 'Start the interview' })).toBeEnabled()
  expect(errors).toEqual([])
})

test('preparation keeps owner selections across reloads and blocks a deleted project without replacing it', async ({
  page,
}) => {
  await page.goto('/app/prepare')
  const claim = page.getByRole('checkbox').first()
  await expect(claim).toBeChecked()
  await claim.click()
  await expect(claim).not.toBeChecked()
  await expect(claim).toBeEnabled()
  await page.reload()
  await expect(claim).not.toBeChecked()
  await claim.click()
  await expect(claim).toBeChecked()
  await expect(claim).toBeEnabled()
  const repository = makeRepository()
  try {
    await page.goto('/app/resume')
    await page.getByRole('textbox', { name: 'Path to a local git repository' }).fill(repository)
    await page.getByRole('button', { name: 'Pin project' }).click()
    await expect(page.getByText(repository, { exact: true })).toBeVisible()
    await page.goto('/app/prepare')
    const select = page.getByRole('combobox', { name: 'Pinned project' })
    const option = select.locator('option').filter({ hasText: repository.split('/').at(-1)! })
    const snapshotId = await option.getAttribute('value')
    expect(snapshotId).toBeTruthy()
    await select.selectOption(snapshotId!)
    await expect(select).toBeEnabled()
    await page.reload()
    await expect(select).toHaveValue(snapshotId!)
    const deleted = await page.request.delete(`/snapshots/${snapshotId}`)
    expect(deleted.ok()).toBe(true)
    await page.goto('/app/session?rounds=code_walkthrough')
    await expect(page.getByRole('button', { name: 'Start the interview' })).toBeDisabled()
    await expect(
      page.getByText('Select an available pinned project', { exact: false }),
    ).toBeVisible()
    await page.goto('/app/session?rounds=cs_fundamentals')
    await expect(page.getByRole('button', { name: 'Start the interview' })).toBeEnabled()
  } finally {
    rmSync(repository, { recursive: true, force: true })
  }
})

test('saved feedback supports disputes and transcript corrections without retaining superseded weaknesses', async ({
  page,
}) => {
  const started = await page.request.post('/sessions', {
    data: {
      topicIds: ['dbms.indexes'],
      mode: 'coach',
      level: 'junior',
      turnsPerRound: 1,
      drill: false,
    },
  })
  expect(started.status()).toBe(201)
  const start = await started.json()
  const answered = await page.request.post(`/sessions/${start.sessionId}/answers`, {
    data: { text: TOPIC_ANSWER },
  })
  expect(answered.ok()).toBe(true)
  await page.goto(`/app/debrief?id=${start.sessionId}`)
  await expect(page.getByRole('region', { name: 'Improvement plan' })).toBeVisible()
  await page.getByText('Correct a transcript or review feedback', { exact: true }).click()
  await page.getByLabel('Finding to review').selectOption({ index: 1 })
  await page
    .getByLabel('Review reason', { exact: true })
    .fill('This interpretation needs review against my complete answer.')
  await page.getByRole('button', { name: 'Flag for review', exact: true }).click()
  await expect(
    page
      .locator('p')
      .filter({ hasText: 'This interpretation needs review against my complete answer.' }),
  ).toBeVisible()
  await page.reload()
  await page.getByText('Correct a transcript or review feedback', { exact: true }).click()
  await expect(page.getByText('pending', { exact: true })).toBeVisible()
  const corrected =
    'The B-tree is maintained on every insert; the earlier transcript omitted that sentence.'
  await page.getByLabel('Corrected transcript', { exact: true }).fill(corrected)
  await page
    .getByLabel('Correction reason', { exact: true })
    .fill('Missing sentence in the transcript.')
  await page.getByRole('button', { name: 'Save transcript correction', exact: true }).click()
  await expect(
    page.getByRole('status').filter({ hasText: 'Previous feedback was superseded' }),
  ).toBeVisible()
  await expect(page.getByText('Superseded feedback', { exact: true })).toBeVisible()
  await expect(
    page.getByText('No supported practice priority is available from this session.', {
      exact: true,
    }),
  ).toBeVisible()
  await page.reload()
  await page.getByText('Correct a transcript or review feedback', { exact: true }).click()
  await expect(page.getByLabel('Corrected transcript', { exact: true })).toHaveValue(corrected)
  const events = await (await page.request.get(`/sessions/${start.sessionId}/events`)).json()
  expect(JSON.stringify(events)).toContain(TOPIC_ANSWER)
  await shot(page, 'feedback-correction')
})

test('an exact gap reaches a separate unfamiliar Transfer with coaching disabled', async ({
  page,
}) => {
  const created = await page.request.post('/sessions', {
    data: {
      topicIds: ['dbms.indexes'],
      mode: 'coach',
      level: 'junior',
      turnsPerRound: 1,
      drill: false,
    },
  })
  const original = await created.json()
  const judged = await (
    await page.request.post(`/sessions/${original.sessionId}/answers`, {
      data: { text: TOPIC_ANSWER },
    })
  ).json()
  const ledger = await (await page.request.get('/ledger')).json()
  const gap = ledger.gaps.find((entry: { findingIds: string[] }) =>
    entry.findingIds.includes(judged.findings[0].id),
  )
  expect(gap).toBeTruthy()
  await page.goto('/app/schedule')
  const scheduled = page.locator(`a[href*="gapId=${gap.id}"]`)
  await expect(scheduled).toHaveText('Practise this gap')
  await scheduled.locator('..').getByRole('button', { name: 'Save this choice' }).click()
  await expect(page.getByText(`Saved choice: drill · ${gap.id}.`, { exact: false })).toBeVisible()
  await page.reload()
  await expect(page.getByText(`Saved choice: drill · ${gap.id}.`, { exact: false })).toBeVisible()
  await scheduled.click()
  await expect(page).toHaveURL(new RegExp(`mode=drill&gapId=${gap.id}`))
  const drill = await (
    await page.request.post('/sessions', { data: { mode: 'drill', gapId: gap.id } })
  ).json()
  await page.request.post(`/sessions/${drill.sessionId}/hints`, { data: { level: 1 } })
  const complete =
    'A B-tree stores sorted keys and row references; every insert updates the index and adds write work.'
  const drilled = await page.request.post(`/sessions/${drill.sessionId}/answers`, {
    data: { text: complete },
  })
  expect(drilled.ok()).toBe(true)
  await page.goto(`/app/debrief?id=${original.sessionId}`)
  const plan = page.getByRole('region', { name: 'Improvement plan' })
  await expect(plan.getByRole('link', { name: 'Practise this priority', exact: true })).toHaveCount(
    0,
  )
  await plan.getByRole('link', { name: 'Check on an unfamiliar variant', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`mode=transfer&gapId=${gap.id}`))
  await page.getByRole('button', { name: 'Start the interview', exact: true }).click()
  await expect(page.getByText('An orders table has a B-tree index', { exact: false })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Show coaching hint' })).toHaveCount(0)
  const sessionId = new URL(page.url()).searchParams.get('id')!
  const saved = await (await page.request.get(`/sessions/${sessionId}`)).json()
  expect(saved.session.practiceGapId).toBe(gap.id)
  expect(saved.session.practiceVariantId).toBe('indexes.tenant_prefix')
  await page
    .getByPlaceholder('Answer in your own words')
    .fill('I do not know how the leftmost prefix affects this report.')
  const accepted = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/sessions/${sessionId}/answers`) &&
      response.request().method() === 'POST',
  )
  await page.getByRole('button', { name: 'Send answer', exact: true }).click()
  expect((await accepted).ok()).toBe(true)
  const after = await (await page.request.get(`/sessions/${sessionId}`)).json()
  expect(after.gaps.find((entry: { id: string }) => entry.id === gap.id).status).toBe('open')
  await page.goto('/app/review')
  await expect(page.getByText('coached', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('transfer', { exact: true }).first()).toBeVisible()
})

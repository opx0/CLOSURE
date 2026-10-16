import { expect, test, type Page } from '@playwright/test'
import { join } from 'node:path'

const ANSWER =
  'An index keeps the keys sorted in a B-tree, so a lookup walks a few pages instead of scanning every row. I am not sure what it costs when the table mostly takes writes.'

async function shot(page: Page, name: string) {
  const dir = process.env.SHOTS_DIR
  if (dir === undefined || dir === '') return
  await page.evaluate(() => document.fonts.ready)
  const viewport = page.viewportSize() ?? { width: 1280, height: 720 }
  const height = await page.evaluate(() => document.documentElement.scrollHeight)
  await page.setViewportSize({ width: viewport.width, height })
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: join(dir, `${name}.png`), animations: 'disabled' })
  await page.setViewportSize(viewport)
}

test('the four destinations connect preparation, optional material, and mobile navigation', async ({
  page,
}) => {
  await page.goto('/app/')
  const navigation = page.getByRole('navigation', { name: 'Primary' })
  await expect(navigation.getByRole('link')).toHaveText([
    'Prepare',
    'Interview',
    'Improve',
    'History',
  ])
  await expect(page.getByRole('heading', { name: 'Prepare', exact: true })).toBeVisible()
  await expect(
    page.locator('header.studio-header').getByRole('navigation', { name: 'Primary' }),
  ).toBeVisible()
  await shot(page, 'prepare-desktop')
  await page.getByRole('link', { name: 'Customize your interview' }).click()
  await expect(page.getByRole('heading', { name: 'Build your next interview.' })).toBeInViewport()
  await page.getByLabel('Interview role').selectOption('backend_services')
  await page.getByRole('button', { name: 'Senior', exact: true }).click()
  await page.getByRole('button', { name: 'System design', exact: true }).click()
  await page.getByLabel('Feedback timing').selectOption('simulation')
  const prepared = new URL(page.url()).searchParams
  await expect(page.getByRole('link', { name: 'Review interview setup' })).toHaveAttribute(
    'href',
    (await page
      .getByRole('link', { name: 'Start an interview', exact: true })
      .getAttribute('href')) ?? '',
  )
  await shot(page, 'prepare-selected')
  await page.getByRole('link', { name: 'Add preparation material', exact: true }).click()
  await page.getByRole('link', { name: 'Back to Prepare', exact: true }).click()
  await expect(page.getByLabel('Interview role')).toHaveValue('backend_services')
  await expect(page.getByRole('button', { name: 'Senior', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await page.getByRole('link', { name: 'Start an interview', exact: true }).click()
  await expect(page.getByRole('button', { name: /^Backend engineer/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(page.getByRole('button', { name: 'senior', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  for (const round of (prepared.get('rounds') ?? '').split(',')) {
    if (round === 'system_design')
      await expect(page.getByRole('button', { name: /^System design/ })).toHaveAttribute(
        'aria-pressed',
        'true',
      )
  }
  await navigation.getByRole('link', { name: 'Improve', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Improve', exact: true })).toBeVisible()
  await shot(page, 'improve')
  await page.getByText('More tools', { exact: true }).click()
  await expect(page.getByRole('link', { name: 'Policy', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Your data', exact: true })).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click()
  await page
    .getByRole('navigation', { name: 'Primary' })
    .getByRole('link', { name: 'History', exact: true })
    .click()
  await expect(page.getByRole('heading', { name: 'History', exact: true })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Primary' })).not.toBeVisible()
  await shot(page, 'history-mobile')
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  expect(overflow).toBe(false)
  await page.getByRole('button', { name: 'Completed', exact: true }).click()
  await expect(page).toHaveURL(/filter=completed/)
  await page.reload()
  await expect(page.getByRole('button', { name: 'Completed', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await page.getByRole('link', { name: 'New interview', exact: true }).click()
  await shot(page, 'prepare-mobile')
  const launch = page.getByRole('link', { name: 'Start an interview', exact: true })
  await expect(launch).toBeVisible()
  const launchBox = await launch.boundingBox()
  expect(launchBox === null ? Infinity : launchBox.y + launchBox.height).toBeLessThanOrEqual(844)
  await page.getByRole('button', { name: 'CS fundamentals', exact: true }).click()
  await expect(launch).toHaveCount(0)
  await expect(
    page.getByText('Choose at least one round to continue.', { exact: true }),
  ).toBeVisible()
})

test('the reference-adapted preparation works at narrow widths and with keyboard navigation', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 740 })
  await page.goto(
    '/app/prepare?role=backend_services&level=junior&rounds=system_design&mode=simulation',
  )
  await expect(page.getByRole('heading', { name: 'Prepare', exact: true })).toBeVisible()
  const launch = page.getByRole('link', { name: 'Start an interview', exact: true })
  await expect(launch).toBeInViewport()
  await page.getByRole('link', { name: 'Customize your interview' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: 'Build your next interview.' })).toBeInViewport()
  await expect(page.getByLabel('Interview role')).toHaveValue('backend_services')
  await expect(page.getByLabel('Feedback timing')).toHaveValue('simulation')
  await expect(page.getByRole('button', { name: 'System design', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await page.getByRole('button', { name: 'System design', exact: true }).focus()
  await page.keyboard.press('Space')
  await expect(launch).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Review interview setup' })).toHaveCount(0)
  await page.keyboard.press('Space')
  await expect(launch).toHaveCount(1)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  expect(overflow).toBe(false)
  await shot(page, 'prepare-narrow')
})

test('evidence remains inspectable when a reply appears beneath the pointer', async ({ page }) => {
  await page.goto('/app/session?role=backend_services&rounds=cs_fundamentals')
  const start = page.getByRole('button', { name: 'Start the interview', exact: true })
  await expect(start).toBeVisible()
  const viewport = page.viewportSize() ?? { width: 1280, height: 720 }
  await page.setViewportSize({
    width: viewport.width,
    height: await page.evaluate(() => document.documentElement.scrollHeight),
  })
  await page.screenshot({ animations: 'disabled' })
  await page.setViewportSize(viewport)
  await start.click()
  await page.getByPlaceholder('Answer in your own words').fill(ANSWER)
  await page.getByRole('button', { name: 'Send answer', exact: true }).click()
  const finding = page
    .getByRole('article')
    .filter({ hasText: 'mechanism — short of the junior anchor' })
  await expect(finding).toBeVisible()
  await finding.getByText('mechanism — short of the junior anchor', { exact: true }).hover()
  await expect(page.locator('mark')).toContainText(
    'I am not sure what it costs when the table mostly takes writes',
  )
  await page.mouse.move(0, 0)
  await finding.focus()
  await expect(page.locator('mark')).toBeVisible()
})

test('a candidate reopens their interview and debrief from history without copying an id', async ({
  page,
}) => {
  await page.goto('/app/')
  await page.getByRole('link', { name: 'Start an interview', exact: true }).click()
  await page.getByRole('button', { name: /^Backend engineer/ }).click()
  await page.getByRole('button', { name: 'Start the interview', exact: true }).click()
  await page.getByPlaceholder('Answer in your own words').fill(ANSWER)
  await page.getByRole('button', { name: 'Send answer', exact: true }).click()
  await expect(page.getByText('mechanism — short of the junior anchor')).toBeVisible()
  const interview = new URL(page.url())
  const interviewPath = `${interview.pathname}${interview.search}`

  await page.getByRole('navigation').getByRole('link', { name: 'History', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'History', exact: true })).toBeVisible()
  await page.reload()
  const saved = page.getByRole('article').filter({
    has: page.locator(`a[href="${interviewPath}"]`),
  })
  await expect(saved.getByText('Backend engineer', { exact: true })).toBeVisible()
  await expect(saved.getByText('1 answer recorded', { exact: true })).toBeVisible()
  await shot(page, 'history')
  await saved.getByRole('link', { name: 'View debrief', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Debrief', exact: true })).toBeVisible()
  await expect(page.getByText('mechanism — short of the junior anchor')).toBeVisible()
  await shot(page, 'debrief')

  await page.getByRole('link', { name: 'Back to history', exact: true }).click()
  await saved.getByRole('link', { name: 'Continue interview', exact: true }).click()
  await expect(page.getByText(ANSWER, { exact: true })).toBeVisible()
  await expect(page.getByPlaceholder('Answer in your own words')).toBeVisible()
  await shot(page, 'interview-reopened')

  await page.goto('/app/debrief')
  await expect(page.getByPlaceholder('session id')).toHaveCount(0)
  await saved.getByRole('link', { name: 'View debrief', exact: true }).click()
  await expect(page.getByText('mechanism — short of the junior anchor')).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await shot(page, 'debrief-mobile')
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
  await page.goto(interviewPath)
  await expect(page.getByText(ANSWER, { exact: true })).toBeVisible()
  await shot(page, 'interview-mobile')
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
  await page.goto(`/app/improve${interview.search}`)
  await expect(page.getByRole('heading', { name: 'Improve', exact: true })).toBeVisible()
  await shot(page, 'improve-mobile')
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
})

test('an answer survives a request failure and can be retried in the same interview', async ({
  page,
}) => {
  await page.goto('/app/session')
  await page.getByRole('button', { name: 'Start the interview', exact: true }).click()
  await page.getByPlaceholder('Answer in your own words').fill(ANSWER)
  await page.route(
    '**/sessions/*/answers',
    (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'temporary test failure' }),
      }),
    { times: 1 },
  )
  await page.getByRole('button', { name: 'Send answer', exact: true }).click()
  await expect(page.getByText('temporary test failure', { exact: true })).toBeVisible()
  await expect(page.getByPlaceholder('Answer in your own words')).toHaveValue(ANSWER)
  await page.getByRole('button', { name: 'Send answer', exact: true }).click()
  await expect(page.getByText('mechanism — short of the junior anchor')).toBeVisible()
  await expect(page.getByPlaceholder('Answer in your own words')).toHaveValue('')
})

test('Simulation handoffs hold new feedback until the interview is complete', async ({ page }) => {
  const response = await page.request.post('/sessions', {
    data: {
      roleId: 'backend_services',
      mode: 'simulation',
      rounds: ['cs_fundamentals', 'system_design'],
      turnsPerRound: 2,
      drill: false,
    },
  })
  expect(response.status()).toBe(201)
  const body: unknown = await response.json()
  if (
    typeof body !== 'object' ||
    body === null ||
    !('sessionId' in body) ||
    typeof body.sessionId !== 'string'
  )
    throw new Error('start response has no session id')
  const sessionId = body.sessionId
  await page.goto(`/app/session?id=${encodeURIComponent(sessionId)}`)
  await page.getByPlaceholder('Answer in your own words').fill(ANSWER)
  await page.getByRole('button', { name: 'Send answer', exact: true }).click()
  await expect(page.getByPlaceholder('Answer in your own words')).toHaveValue('')
  await expect(
    page.getByRole('link', { name: 'Your practice workspace', exact: true }),
  ).toHaveCount(0)
  await page.goto(`/app/debrief?id=${encodeURIComponent(sessionId)}`)
  await expect(page.getByRole('link', { name: 'Return to simulation', exact: true })).toBeVisible()
  await expect(page.getByText('mechanism — short of the junior anchor')).toHaveCount(0)
  await page.goto(`/app/improve?id=${encodeURIComponent(sessionId)}`)
  await expect(
    page.getByRole('heading', { name: 'A simulation is in progress', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'Evidence-backed areas to practise', exact: true }),
  ).toHaveCount(0)
  await page.getByRole('link', { name: 'Return to simulation', exact: true }).click()
  await expect(page.getByText('mechanism — short of the junior anchor')).toHaveCount(0)
  await page.getByPlaceholder('Answer in your own words').fill(ANSWER)
  await page.getByRole('button', { name: 'Send answer', exact: true }).click()
  await expect(page.getByText('mechanism — short of the junior anchor')).toHaveCount(1)
  await page.reload()
  await expect(page.getByText('mechanism — short of the junior anchor')).toHaveCount(1)
  await page.getByPlaceholder('Answer in your own words').fill(ANSWER)
  await page.getByRole('button', { name: 'Send answer', exact: true }).click()
  await expect(page.getByPlaceholder('Answer in your own words')).toHaveValue('')
  await page.reload()
  await expect(page.getByText('mechanism — short of the junior anchor')).toHaveCount(1)
  await page.getByPlaceholder('Answer in your own words').fill(ANSWER)
  await page.getByRole('button', { name: 'Send answer', exact: true }).click()
  await expect(page.getByText('Interview complete', { exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Your practice workspace', exact: true }).click()
  await page.getByRole('link', { name: "Return to this interview's feedback", exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Debrief', exact: true })).toBeVisible()
  await expect(page.getByText('mechanism — short of the junior anchor').first()).toBeVisible()
})

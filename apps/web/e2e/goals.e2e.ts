import { expect, test } from '@playwright/test'

test('goals survive reload and the saved role and level set up the next interview', async ({
  page,
}) => {
  await page.goto('/app/')
  await page.getByLabel('Interview role').selectOption('backend_services')
  await page.getByRole('button', { name: 'Mid', exact: true }).click()
  await page.getByLabel('What do you want to practise?').fill('Explain database indexes')
  await page.getByLabel('Minutes for next practice (optional)').fill('35')
  await page
    .getByLabel('Job description (optional)')
    .fill('Requirements:\n- PostgreSQL and TypeScript')
  await page.getByRole('button', { name: 'Save goals' }).click()
  await expect(page.getByRole('status')).toContainText('Goals saved')
  await page.goto('/app/')
  await expect(page.getByLabel('What do you want to practise?')).toHaveValue(
    'Explain database indexes',
  )
  await expect(page.getByLabel('Minutes for next practice (optional)')).toHaveValue('35')
  await expect(
    page.getByText('Possible terms from your job description:', { exact: false }),
  ).toBeVisible()
  await expect(page.getByLabel('Interview role')).toHaveValue('backend_services')
  await expect(page.getByRole('button', { name: 'Mid', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await page.goto('/app/schedule')
  await expect(page.getByRole('link', { name: 'Practise this topic' })).toHaveAttribute(
    'href',
    /turns=7/,
  )
  await expect(
    page.getByText('Planning assumes five minutes per question', { exact: false }),
  ).toBeVisible()
  await page.goto('/app/')
  await page.getByLabel('Minutes for next practice (optional)').fill('4')
  await page.getByRole('button', { name: 'Save goals' }).click()
  await expect(page.getByRole('status')).toContainText('Goals saved')
  await page.goto('/app/schedule')
  await expect(page.getByRole('link', { name: 'Practise this topic' })).toHaveCount(0)
  await expect(
    page.getByText('The saved time is shorter than the five-minute question estimate.'),
  ).toBeVisible()
  await page.goto('/app/')
  await page.getByLabel('Minutes for next practice (optional)').fill('')
  await page.getByRole('button', { name: 'Junior', exact: true }).click()
  await page.getByRole('button', { name: 'Save goals' }).click()
  await page.goto('/app/')
  await expect(page.getByLabel('Minutes for next practice (optional)')).toHaveValue('')
})

test('an untested topic is passed to interview setup', async ({ page }) => {
  const plan = await (await page.request.get('/schedule')).json()
  expect(plan.coverage).not.toBeNull()
  await page.goto('/app/schedule')
  await page.getByRole('link', { name: 'Practise this topic' }).click()
  await expect(page.getByRole('heading', { name: 'Selected topic' })).toBeVisible()
  await expect(page.getByText(plan.coverage.title, { exact: true })).toBeVisible()
  const sent = page.waitForRequest(
    (request) => request.url().endsWith('/sessions') && request.method() === 'POST',
  )
  await page.route('**/sessions', (route) =>
    route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Test interception', detail: 'No session created.' }),
    }),
  )
  await page.getByRole('button', { name: 'Start the interview', exact: true }).click()
  expect((await sent).postDataJSON().topicIds).toEqual([plan.coverage.id])
})

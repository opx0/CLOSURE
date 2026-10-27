import { expect, test } from '@playwright/test'

test('a confirmed story version can be edited, rehearsed and reopened with cited answer evidence', async ({
  page,
}) => {
  await page.goto('/app/stories')
  await page.getByLabel('Situation', { exact: true }).fill('A job queue stalled during a release.')
  await page
    .getByLabel('Action', { exact: true })
    .fill('I inspected the lease and restarted the worker.')
  await page.locator('textarea[name=result]').fill('The backlog cleared.')
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Save story', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Story · version 1' })).toBeVisible()
  await page.getByRole('button', { name: 'Edit story' }).click()
  await page.locator('textarea[name=result]').fill('The backlog cleared within an hour.')
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Save new version' }).click()
  await expect(page.getByRole('heading', { name: 'Story · version 2' })).toBeVisible()
  await page.getByText('Earlier versions', { exact: true }).click()
  await page.getByRole('link', { name: 'Rehearse version 1' }).click()
  await expect(page.getByText('Version 1 will be saved with this interview.')).toBeVisible()
  await page.getByText('Advanced options').click()
  await page.getByLabel('Questions per round').fill('2')
  await page.getByRole('button', { name: 'Start the interview' }).click()
  await expect(page).toHaveURL(/id=/)
  const id = new URL(page.url()).searchParams.get('id')!
  const answer = 'I inspected the lease and restarted the worker, then the backlog cleared.'
  for (let i = 0; i < 2; i++) {
    const response = await page.request.post(`/sessions/${id}/answers`, { data: { text: answer } })
    expect(response.ok()).toBe(true)
  }
  const saved = await (await page.request.get(`/sessions/${id}`)).json()
  expect(saved.session.story.revision).toBe(1)
  expect(saved.findings.length).toBeGreaterThan(0)
  expect(saved.quotes.some((entry: { quoted: string }) => answer.includes(entry.quoted))).toBe(true)
  await page.goto(`/app/debrief?id=${encodeURIComponent(id)}`)
  await page.getByText('Confirmed story · version 1').click()
  await expect(page.getByText('Result: The backlog cleared.', { exact: false })).toBeVisible()
})

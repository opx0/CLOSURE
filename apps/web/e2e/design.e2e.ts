import { expect, test } from '@playwright/test'

test('a changed design constraint can be rehearsed and inspected beside reopened evidence', async ({
  page,
}) => {
  await page.goto('/app/designs')
  await page.getByRole('textbox', { name: 'Scenario title' }).fill('Notification service')
  await page
    .getByRole('textbox', { name: 'Requirements' })
    .fill('Retry delivery without duplicate notifications.')
  await page.getByRole('textbox', { name: 'Capacity estimates' }).fill('100 requests per second.')
  await page.getByRole('textbox', { name: 'API and boundaries' }).fill('POST /notifications')
  await page.getByRole('textbox', { name: 'Data model' }).fill('notification(id, recipient, state)')
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
  await page.reload()
  await expect(page.getByText('Design used · Notification service · revision 2')).toBeVisible()
})

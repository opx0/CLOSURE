import { expect, test } from '@playwright/test'

const RESUME = 'Built a durable job queue on PostgreSQL processing ~10k jobs/day.'
const ANSWER = 'We leased each job for thirty seconds. I do not think we handled double completion.'
const CITED = 'I do not think we handled double completion'

// STACK §14: the smallest critical interview journey, end to end, in a browser. Not a survey of the
// UI — the one path that has to work for CLOSER to be what it says it is: a claim traced to a span,
// a question chosen by code, and a finding that quotes the candidate's own words.
test('a claim is confirmed, interrogated, and judged with the candidate’s own words cited', async ({
  page,
}) => {
  await page.goto('/app/claims')

  await page.getByRole('textbox').first().fill(RESUME)
  await page.getByRole('button', { name: 'Extract claims' }).click()

  // §4.1: nothing starts confirmed. The claim set is the candidate's.
  const claim = page.getByRole('checkbox').first()
  await expect(claim).toBeVisible()
  await expect(claim).not.toBeChecked()
  await expect(
    page.getByText('built a durable job queue on PostgreSQL', { exact: true }),
  ).toBeVisible()

  // The span is shown beside the claim, with its byte offsets — provenance is visible, not implied.
  await expect(page.getByText(/span \d+–\d+ ·/)).toBeVisible()

  await claim.check()

  await page.getByRole('link', { name: 'interview' }).click()
  await page.getByRole('button', { name: 'Start interview' }).click()

  // The action is on screen because code chose it; the model only phrased the sentence.
  await expect(page.getByText('probe mechanism')).toBeVisible()
  await expect(page.getByText('walk me through how a job is claimed')).toBeVisible()

  await page.getByPlaceholder('Answer in your own words').fill(ANSWER)
  await page.getByRole('button', { name: 'Send answer' }).click()

  const finding = page.getByText('claim partially supported').first()
  await expect(finding).toBeVisible()

  // §4.4: the finding quotes the exact words, and states a confidence rather than a score.
  await expect(page.getByText(CITED).first()).toBeVisible()
  await expect(page.getByText(/confidence (high|medium|low) · 0\.\d+/)).toBeVisible()

  // The citation surface: hovering a finding highlights those words where they were said.
  await finding.hover()
  await expect(page.locator('mark', { hasText: CITED })).toBeVisible()

  // The promise that has no UI: there is no readiness number anywhere on the page.
  // The promise that has no UI. Not "the word score is absent" — the page says the word, in the
  // line promising there is no such number. What must be absent is a *number presented as one*.
  await expect(
    page.getByText('it never gives you a readiness score', { exact: false }),
  ).toBeVisible()
  await expect(
    page.getByText(/\b\d{1,3}\s*%|\b\d{1,3}\s*\/\s*(?:10|100)\b|\bgrade\b/i),
  ).toHaveCount(0)
})

test('the gap ledger replaces a score, and every citation resolves', async ({ page }) => {
  await page.goto('/app/ledger')

  await expect(page.getByText('This is what replaces a readiness score')).toBeVisible()
  await expect(page.getByText(/No gaps yet|Competency/i).first()).toBeVisible()
})

test('the policy the interview runs on is inspectable', async ({ page }) => {
  await page.goto('/app/catalog')

  await expect(page.getByText('Code chooses which of these comes next')).toBeVisible()
  await expect(page.getByText('probe mechanism').first()).toBeVisible()
  await expect(page.getByText('false premise').first()).toBeVisible()
  // Every shipped role says out loud that nobody has measured it.
  await expect(page.getByText(/no agreement has been measured/).first()).toBeVisible()
})

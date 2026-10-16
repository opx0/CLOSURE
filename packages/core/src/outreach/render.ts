import type { Nudge, NudgeChannel } from '@levelhead/contracts'
import type { PlannedWork, SessionPlan } from '../schedule/plan.ts'

export interface RenderNudgeInput {
  plan: SessionPlan
  channel: NudgeChannel
  to: string
  id: string
  now: string
}

// What the candidate is told about each piece of work, taken from the planner's own reason so the
// message can only ever describe work the schedule actually raised.
//
// `retrieve_the_closed_gap` is deliberately unsayable. A closed gap returns as an ordinary
// interview question and is never announced (CONTEXT.md, "Retrieval"): telling the candidate one is
// coming changes what the retrieval measures from recall to recognition. Holding that rule as a
// `null` row rather than a filter elsewhere means a fifth reason cannot be added without answering
// the question of whether it may be named.
const WHY: Record<PlannedWork['reason'], string | null> = {
  drill_the_open_gap: 'open, not drilled yet',
  transfer_the_drilled_gap: 'drilled, not yet retested under changed constraints',
  restate_the_unverified: 'left unverified when the evaluator abstained',
  retrieve_the_closed_gap: null,
}

interface ChannelShape {
  subject: boolean
  maxItems: number
  paragraphBreak: string
}

// SMS is one screen and costs per segment, email can carry the whole ledger, WhatsApp sits between.
const SHAPE: Record<NudgeChannel, ChannelShape> = {
  email: { subject: true, maxItems: 12, paragraphBreak: '\n\n' },
  whatsapp: { subject: false, maxItems: 5, paragraphBreak: '\n\n' },
  sms: { subject: false, maxItems: 2, paragraphBreak: '\n' },
}

function quantify(n: number): string {
  return `${n} ${n === 1 ? 'gap' : 'gaps'}`
}

// Null is the common answer and the correct one. Nothing is due most days, and a message sent on a
// day nothing is due would be a message about work the candidate does not have.
export function renderNudge(input: RenderNudgeInput): Nudge | null {
  const now = Date.parse(input.now)
  const due = input.plan.work.flatMap((entry) => {
    const why = WHY[entry.reason]
    if (why === null || Date.parse(entry.dueAt) > now) return []
    return [{ id: entry.gap.id, summary: entry.gap.summary, why, dueAt: entry.dueAt }]
  })

  // The planner sorts its work by due date, so the first survivor is the one that has waited
  // longest, and it is the date this nudge is honestly about.
  const [earliest] = due
  if (earliest === undefined) return null

  const shape = SHAPE[input.channel]
  const listed = due.slice(0, shape.maxItems)
  const unlisted = due.length - listed.length

  return {
    id: input.id,
    channel: input.channel,
    to: input.to,
    subject: shape.subject ? `${quantify(due.length)} due in Levelhead` : null,
    body: [
      `${quantify(due.length)} from your own sessions ${due.length === 1 ? 'is' : 'are'} due.`,
      listed.map((item) => `- ${item.summary} (${item.why}) [${item.id}]`).join('\n'),
      ...(unlisted === 0 ? [] : [`${quantify(unlisted)} not listed above.`]),
    ].join(shape.paragraphBreak),
    dueAt: earliest.dueAt,
    gapIds: due.map((item) => item.id),
  }
}

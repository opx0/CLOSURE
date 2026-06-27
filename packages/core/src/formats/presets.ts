import type { InterviewFormat, Level, PersonaId, RoundKind } from '@closer/contracts'

const NOT_AFFILIATED =
  'Derived from the named published guidance only. Not affiliated with, endorsed by, or a reproduction of any company’s real interview loop, and no company’s private material is used.'

const AMAZON_GUIDE = {
  publisher: 'Amazon',
  title: 'Interview prep — software development topics',
  url: 'https://amazon.jobs/content/en/how-we-hire/interview-prep/software-development-topics',
  readOn: '2026-09-03',
}

const META_GUIDE = {
  publisher: 'Meta',
  title: 'Preparing for your software engineering interview at Meta',
  url: 'https://www.metacareers.com/blog/preparing-for-your-software-engineering-interview-at-meta/',
  readOn: '2026-09-03',
}

const MICROSOFT_GUIDE = {
  publisher: 'Microsoft',
  title: 'Hiring tips — technical interviewing',
  url: 'https://careers.microsoft.com/v2/global/en/hiring-tips/technical-interviewing',
  readOn: '2026-09-03',
}

const OPENAI_GUIDE = {
  publisher: 'OpenAI',
  title: 'Interview guide',
  url: 'https://openai.com/interview-guide/',
  readOn: '2026-09-03',
}

function round(
  kind: RoundKind,
  personaId: PersonaId,
  turns: number,
  pressureCeiling: number,
  emphasis: string,
) {
  return { kind, personaId, turns, pressureCeiling, emphasis }
}

export const INTERVIEW_FORMATS: readonly InterviewFormat[] = [
  {
    id: 'ownership_and_depth',
    label: 'Ownership and depth (Amazon-style guidance)',
    derivedFrom: [AMAZON_GUIDE],
    disclaimer: NOT_AFFILIATED,
    defaultLevel: 'mid',
    rounds: [
      round('behavioral', 'skeptic', 6, 2, 'what decision was yours alone, and what did it cost'),
      round('project_deep_dive', 'bar_raiser', 6, 2, 'mechanism and the failure modes you own'),
      round(
        'design_extension',
        'bar_raiser',
        5,
        2,
        'scale the thing you built and defend the change',
      ),
    ],
  },
  {
    id: 'design_and_execution',
    label: 'Design and execution (Meta-style guidance)',
    derivedFrom: [META_GUIDE],
    disclaimer: NOT_AFFILIATED,
    defaultLevel: 'senior',
    rounds: [
      round('project_deep_dive', 'collaborator', 5, 1, 'walk the system you actually built'),
      round('design_extension', 'bar_raiser', 7, 3, 'constraints change fast; hold the thread'),
      round('behavioral', 'collaborator', 4, 1, 'collaboration evidence, not adjectives'),
    ],
  },
  {
    id: 'problem_framing',
    label: 'Problem framing (Microsoft-style guidance)',
    derivedFrom: [MICROSOFT_GUIDE],
    disclaimer: NOT_AFFILIATED,
    defaultLevel: 'mid',
    rounds: [
      round('project_deep_dive', 'collaborator', 6, 1, 'assumptions stated before solutions'),
      round('code_walkthrough', 'skeptic', 5, 2, 'read your own code back and defend it'),
      round('design_extension', 'skeptic', 5, 2, 'what you would change now, and why'),
    ],
  },
  {
    id: 'applied_research_defense',
    label: 'Applied research defense (OpenAI-style guidance)',
    derivedFrom: [OPENAI_GUIDE],
    disclaimer: NOT_AFFILIATED,
    defaultLevel: 'senior',
    rounds: [
      round('project_deep_dive', 'skeptic', 7, 3, 'what was measured versus what was assumed'),
      round(
        'design_extension',
        'bar_raiser',
        6,
        3,
        'the evaluation you would run to know you were wrong',
      ),
    ],
  },
  {
    id: 'single_round_deep_dive',
    label: 'Single-round project defense',
    derivedFrom: [AMAZON_GUIDE, META_GUIDE, MICROSOFT_GUIDE, OPENAI_GUIDE],
    disclaimer: NOT_AFFILIATED,
    defaultLevel: 'mid',
    rounds: [round('project_deep_dive', 'collaborator', 6, 1, 'one claim, defended end to end')],
  },
]

export function interviewFormat(id: string): InterviewFormat | undefined {
  return INTERVIEW_FORMATS.find((format) => format.id === id)
}

export interface FormatPlan {
  rounds: RoundKind[]
  personaId: PersonaId
  turnsPerRound: number
  pressureCeiling: number
  level: Level
}

export function planFromFormat(format: InterviewFormat): FormatPlan {
  const first = format.rounds[0]
  if (first === undefined) throw new Error(`format ${format.id} declares no rounds`)
  return {
    rounds: format.rounds.map((entry) => entry.kind),
    personaId: first.personaId,
    turnsPerRound: Math.max(...format.rounds.map((entry) => entry.turns)),
    pressureCeiling: Math.max(...format.rounds.map((entry) => entry.pressureCeiling)),
    level: format.defaultLevel,
  }
}

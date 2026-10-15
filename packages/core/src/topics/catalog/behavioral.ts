import type { Topic } from '@levelhead/contracts'

export const BEHAVIORAL_TOPICS: readonly Topic[] = [
  {
    id: 'behavioral.disagreement',
    area: 'behavioral',
    title: 'A disagreement with a teammate',
    ask: 'Ask them to tell you about a time they disagreed with a teammate on a technical decision and how it was resolved.',
    minLevel: 'junior',
    expected: {
      mechanism: [
        'what they personally did to understand the other view',
        'the evidence they brought, not just their opinion',
        'how the decision was finally made and who made it',
      ],
      trade_offs: [
        'what giving in, or pushing harder, would have cost',
        'the time the disagreement took against the quality of the result',
        'the effect on the working relationship',
      ],
      failure_modes: [
        'how the chosen option actually turned out',
        'where they themselves were wrong',
        'what they would do differently next time',
      ],
    },
    falsePremise:
      'So your teammate was simply being stubborn, and the disagreement was entirely their fault.',
    twist: 'the same disagreement, but with your manager, and the deadline is tomorrow',
  },
  {
    id: 'behavioral.failed_project',
    area: 'behavioral',
    title: 'A project that failed',
    ask: 'Ask them to tell you about a time a project they worked on failed or missed its goal.',
    minLevel: 'junior',
    expected: {
      mechanism: [
        'their own role and decisions, in the first person',
        'the point where things started to go wrong',
        'what they did once they noticed',
      ],
      trade_offs: [
        'what the failure cost the team or the users',
        'what they chose to cut or keep as it went wrong',
        'why they did not change course earlier',
      ],
      failure_modes: [
        'the root cause beyond bad luck',
        'the concrete change they made afterwards',
        'owning their share without shifting blame',
      ],
    },
    falsePremise:
      'So the project failed because of bad timing and luck, and nothing you decided made a difference.',
    twist: 'the same project, but you were leading it and a customer had already paid for it',
  },
  {
    id: 'behavioral.ownership',
    area: 'behavioral',
    title: 'Ownership beyond your role',
    ask: 'Ask them to tell you about a time they took ownership of a problem that was not strictly their job.',
    minLevel: 'junior',
    expected: {
      mechanism: [
        'what the problem was and why nobody else was handling it',
        'what they personally did, in the first person',
        'who they told or brought in, and when',
      ],
      trade_offs: [
        'what they set aside from their own work to take it on',
        'fixing it themselves against raising it with the people who owned it',
        "stepping in against stepping on someone else's area",
      ],
      failure_modes: [
        'the concrete outcome, including what did not get fixed',
        'whether the fix lasted after they stepped back',
        'what they would hand off or escalate sooner next time',
      ],
    },
    falsePremise:
      'So ownership means doing everything yourself, and bringing in the people who owned the problem would have been a sign of weakness.',
    twist:
      'the same problem, but fixing it means changing code another team owns, and that team is away for a week',
  },
  {
    id: 'behavioral.tight_deadline',
    area: 'behavioral',
    title: 'A tight deadline',
    ask: 'Ask them to tell you about a time they had to deliver something under a deadline that looked impossible.',
    minLevel: 'junior',
    expected: {
      mechanism: [
        'what the deadline and the scope were, and why it looked impossible',
        'how they planned: what they broke down, estimated and did first',
        'how they reported progress and risk along the way',
      ],
      trade_offs: [
        'what they cut, simplified or deferred to make the date',
        'the testing or quality they gave up, and whether it was made up later',
        'moving the date against cutting scope, and who agreed to it',
      ],
      failure_modes: [
        'whether it shipped on time and what broke afterwards',
        'the shortcuts left behind and whether they were ever cleaned up',
        'what they would push back on earlier next time',
      ],
    },
    falsePremise:
      'So hitting the date was all that mattered, and whatever broke after launch was not part of your job.',
    twist: 'the same deadline, but halfway through, a key teammate is out sick for the rest of it',
  },
  {
    id: 'behavioral.learning_fast',
    area: 'behavioral',
    title: 'Learning something fast',
    ask: 'Ask them to tell you about a time they had to learn an unfamiliar technology or domain quickly to get something done.',
    minLevel: 'junior',
    expected: {
      mechanism: [
        'what they needed to learn and by when',
        'how they learned it: documentation, source code, small experiments, people they asked',
        'how they checked that they had understood it correctly',
      ],
      trade_offs: [
        'learning it deeply against learning just enough to ship',
        'asking someone early against working it out alone',
        'using the new tool against falling back on one they already knew',
      ],
      failure_modes: [
        'a mistake they made because of what they had not learned yet',
        'what they would learn differently next time',
        'whether they could explain it to someone else now',
      ],
    },
    falsePremise:
      'So after learning it well enough to ship, you now know it as well as someone who has used it for years.',
    twist:
      'the same technology, but you have two days and the only expert has just left the company',
  },
  {
    id: 'behavioral.hard_feedback',
    area: 'behavioral',
    title: 'Receiving hard feedback',
    ask: 'Ask them to tell you about a time they received critical feedback that was hard to hear, and what they did with it.',
    minLevel: 'junior',
    expected: {
      mechanism: [
        'what the feedback was, as close to the words they heard as they can recall',
        'their first reaction, honestly',
        'the concrete change they made afterwards',
      ],
      trade_offs: [
        'what they agreed with and what they pushed back on, and why',
        'what changing cost them, such as slower work or a new habit to build',
        'acting on it at once against asking for more examples first',
      ],
      failure_modes: [
        'evidence that the change actually stuck',
        'what they still find hard about it',
        'how they now ask for feedback before it becomes hard to hear',
      ],
    },
    falsePremise: 'So the feedback was unfair, and nothing in it was worth acting on.',
    twist:
      'the same feedback, but it comes in your first week, from a senior engineer, in front of the team',
  },
]

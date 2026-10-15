import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import type { GapEntry } from '@levelhead/contracts'
import { planNextSession, replay, type EventStore } from '@levelhead/core'
import type { GateVerdict } from './gate.ts'

export interface McpDeps {
  store: EventStore
  now: () => string
  gate: GateVerdict
}

const TOOLS = [
  {
    name: 'levelhead_gap_ledger',
    description:
      'The candidate’s open, drilled, unverified and closed gaps, with the exact words each was found in. There is no readiness score and no aggregate.',
    inputSchema: { type: 'object' as const, properties: {}, additionalProperties: false },
  },
  {
    name: 'levelhead_due',
    description: 'What is due for drill, transfer or unannounced retrieval within a horizon.',
    inputSchema: {
      type: 'object' as const,
      properties: { horizonDays: { type: 'number', minimum: 1, maximum: 365 } },
      additionalProperties: false,
    },
  },
  {
    name: 'levelhead_session',
    description:
      'One session replayed from its append-only log: transcript, findings with citations, and the plan behind every question.',
    inputSchema: {
      type: 'object' as const,
      properties: { sessionId: { type: 'string' } },
      required: ['sessionId'],
      additionalProperties: false,
    },
  },
]

function text(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] }
}

// A thin adapter over the same use cases the CLI and the HTTP API drive — never a second
// architecture (ADR-011). It is read-only on purpose: an external agent may inspect what Levelhead
// found, and may not run an interview on the candidate's behalf.
export function buildMcpServer(deps: McpDeps): Server {
  const server = new Server(
    { name: 'levelhead', version: '0.0.0' },
    { capabilities: { tools: {} } },
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }))

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const args = (request.params.arguments ?? {}) as Record<string, unknown>

    switch (request.params.name) {
      case 'levelhead_gap_ledger': {
        const gaps = new Map<string, GapEntry>()
        const quotes = new Map<string, string>()
        for (const sessionId of await deps.store.listSessions()) {
          const view = replay(await deps.store.read(sessionId))
          for (const [id, gap] of view.gaps) {
            const known = gaps.get(id)
            if (known === undefined || gap.lastTouchedAt >= known.lastTouchedAt) gaps.set(id, gap)
          }
          for (const link of view.evidence.values()) {
            if (link.target.kind !== 'span') continue
            const span = view.spans.get(link.target.spanId)
            if (span !== undefined) quotes.set(link.id, span.quoted)
          }
        }
        return text({
          gaps: [...gaps.values()],
          quotes: [...quotes].map(([evidenceId, quoted]) => ({ evidenceId, quoted })),
          note: 'no aggregate score exists in this system, by design',
        })
      }

      case 'levelhead_due': {
        const gaps = new Map<string, GapEntry>()
        for (const sessionId of await deps.store.listSessions()) {
          for (const gap of replay(await deps.store.read(sessionId)).gaps.values()) {
            const known = gaps.get(gap.id)
            if (known === undefined || gap.lastTouchedAt >= known.lastTouchedAt) {
              gaps.set(gap.id, gap)
            }
          }
        }
        return text(
          planNextSession({
            gaps: [...gaps.values()],
            now: deps.now(),
            horizonDays: typeof args['horizonDays'] === 'number' ? args['horizonDays'] : 7,
            retrievalLimit: 3,
          }),
        )
      }

      case 'levelhead_session': {
        const sessionId = String(args['sessionId'] ?? '')
        const events = await deps.store.read(sessionId)
        if (events.length === 0) {
          return { ...text({ error: 'no such session', sessionId }), isError: true }
        }
        const view = replay(events)
        return text({
          sessionId: view.sessionId,
          transcript: view.transcript,
          findings: view.findings,
          gaps: [...view.gaps.values()],
          plans: events.filter((event) => event.kind === 'plan').map((event) => event.payload),
          totals: view.totals,
        })
      }

      default:
        return { ...text({ error: `unknown tool ${request.params.name}` }), isError: true }
    }
  })

  return server
}

// Exercises the CLI over a real socket — adapters, HTTP shapes, JSON parsing — without a model,
// container or key.
export interface FakeProviderScript {
  claims?: unknown
  evaluations?: readonly unknown[]
  questions?: readonly string[]
}

export function startFakeProvider(script: FakeProviderScript, port = 0) {
  const evaluations = [...(script.evaluations ?? [])]
  const questions = [...(script.questions ?? [])]

  return Bun.serve({
    port,
    async fetch(request) {
      const url = new URL(request.url)
      if (url.pathname.endsWith('/models')) {
        return Response.json({ data: [{ id: 'local/llama.cpp' }] })
      }
      if (!url.pathname.endsWith('/chat/completions')) {
        return new Response('not found', { status: 404 })
      }

      const body = (await request.json()) as {
        response_format?: { json_schema?: { name?: string } }
      }
      const schemaName = body.response_format?.json_schema?.name

      // A structured request is the Evaluator path; a plain one is the Conductor rendering words.
      const content =
        schemaName === undefined
          ? (questions.shift() ?? 'And?')
          : JSON.stringify(
              schemaName.toLowerCase().includes('claim')
                ? (script.claims ?? { claims: [] })
                : (evaluations.shift() ?? { findings: [] }),
            )

      return Response.json({
        choices: [{ message: { content }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      })
    },
  })
}

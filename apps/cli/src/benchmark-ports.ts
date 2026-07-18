import { fromEnv } from './adapters/index.ts'
import { OpenAiCompatibleConductor } from './adapters/conductor-openai.ts'
import { LOCAL_MODEL_ALIAS } from './adapters/pricing.ts'
import { RandomIds, SystemClock } from './runtime.ts'
import { loadCliConfig } from './config.ts'

// Passed as `--ports` — lives here, not in `benchmarks/`, which must not know how a provider is reached.
export default function benchmarkPorts() {
  const config = loadCliConfig()
  const { conductor, evaluator } = fromEnv(process.env)

  // The two model-layer arms (PROJECT.md §6.1). Each is present only when it is actually reachable;
  // an absent one makes its arm publish a failure rather than a number produced by another model.
  const headlessCommand = process.env.CLOSER_HEADLESS_AGENT_URL
  const alternateConductors = {
    closer_local_model: new OpenAiCompatibleConductor({
      baseUrl: config.llamaBaseUrl,
      modelAlias: LOCAL_MODEL_ALIAS,
    }),
    ...(headlessCommand === undefined
      ? {}
      : {
          closer_headless_agent: new OpenAiCompatibleConductor({
            baseUrl: headlessCommand,
            modelAlias: `${LOCAL_MODEL_ALIAS}-headless`,
            ...(config.apiKey === undefined ? {} : { apiKey: config.apiKey }),
          }),
        }),
  }

  return {
    conductor,
    evaluator,
    alternateConductors,
    clock: new SystemClock(),
    ids: new RandomIds(),
    ceilings: {
      sessionCostUsd: config.sessionCostCeilingUsd,
      sessionTokens: config.sessionTokenCeiling,
      modelCallsPerTurn: config.modelCallsPerTurnCeiling,
    },
  }
}

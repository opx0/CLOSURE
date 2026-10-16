// Restated, not imported (importing @levelhead/core's types back would close a cycle) — one type for every prompt, since the Conductor and Evaluator must look at the same lines.
export interface PromptArtifact {
  path: string
  symbol?: string | undefined
  // 1-based and inclusive, as in the `Artifact` contract, and absent for a whole file.
  startLine?: number | undefined
  endLine?: number | undefined
  code: string
}

export function checkLocalGeneration(env: Record<string, string | undefined>): void {
  const flag = env.LEVELHEAD_LOCAL_ONLY
  if (flag !== undefined && flag !== 'true' && flag !== 'false') {
    throw new Error('LEVELHEAD_LOCAL_ONLY must be true or false')
  }
  if (flag !== 'true') return
  if (env.MODEL_PROVIDER_API_KEY) {
    throw new Error('Local-only generation rejects MODEL_PROVIDER_API_KEY; unset it')
  }
  let url: URL
  try {
    url = new URL(env.LLAMA_BASE_URL ?? 'http://localhost:8081/v1')
  } catch {
    throw new Error('Local-only generation requires a valid LLAMA_BASE_URL')
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      'Local-only generation requires a loopback LLAMA_BASE_URL without credentials, query or fragment',
    )
  }
}

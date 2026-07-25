import { createHash, timingSafeEqual } from 'node:crypto'
import { LOCAL_PRINCIPAL, type Principal, type PrincipalRole } from '@closer/contracts'

export interface TokenGrant {
  ownerId: string
  role: PrincipalRole
  digest: Buffer
}

const ROLES: readonly PrincipalRole[] = ['candidate', 'operator', 'showcase']

function digestOf(token: string): Buffer {
  return createHash('sha256').update(token).digest()
}

// `owner:token` or `owner:role:token`, comma-separated. Parsed once at boot; the raw token never
// leaves this module and never reaches a log line.
export function parseTokens(spec: string): TokenGrant[] {
  const grants: TokenGrant[] = []
  for (const entry of spec.split(',')) {
    const trimmed = entry.trim()
    if (trimmed === '') continue
    const parts = trimmed.split(':')
    const ownerId = parts[0] ?? ''
    const hasRole = parts.length >= 3 && ROLES.includes(parts[1] as PrincipalRole)
    const role = (hasRole ? parts[1] : 'candidate') as PrincipalRole
    const token = (hasRole ? parts.slice(2) : parts.slice(1)).join(':')
    if (ownerId === '' || token === '') {
      throw new Error(`CLOSER_API_TOKENS entry ${JSON.stringify(trimmed)} is not owner:token`)
    }
    grants.push({ ownerId, role, digest: digestOf(token) })
  }
  return grants
}

export class Principals {
  readonly #grants: readonly TokenGrant[]

  constructor(spec: string) {
    this.#grants = parseTokens(spec)
  }

  get open(): boolean {
    return this.#grants.length === 0
  }

  // With no tokens configured the server is the developer's own machine and every caller is the
  // local owner. With tokens configured an unrecognised one is nobody, never a fallback to local.
  resolve(header: string | undefined): Principal | null {
    if (this.open) return LOCAL_PRINCIPAL
    if (header === undefined) return null

    const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : ''
    if (token === '') return null

    const offered = digestOf(token)
    for (const grant of this.#grants) {
      if (grant.digest.length === offered.length && timingSafeEqual(grant.digest, offered)) {
        return { ownerId: grant.ownerId, role: grant.role, label: grant.ownerId }
      }
    }
    return null
  }
}

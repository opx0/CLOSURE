import { Type, type Static } from '@sinclair/typebox'

export const LOCAL_OWNER_ID = 'local'

export const OwnerIdSchema = Type.String({
  minLength: 1,
  maxLength: 64,
  pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$',
})
export type OwnerId = Static<typeof OwnerIdSchema>

export const PrincipalRoleSchema = Type.Union([
  Type.Literal('candidate'),
  Type.Literal('operator'),
  Type.Literal('showcase'),
])
export type PrincipalRole = Static<typeof PrincipalRoleSchema>

export const PrincipalSchema = Type.Object({
  ownerId: OwnerIdSchema,
  role: PrincipalRoleSchema,
  label: Type.String({ minLength: 1 }),
})
export type Principal = Static<typeof PrincipalSchema>

export const LOCAL_PRINCIPAL: Principal = {
  ownerId: LOCAL_OWNER_ID,
  role: 'operator',
  label: 'local developer',
}

export function ownsSession(principal: Principal, sessionOwnerId: OwnerId): boolean {
  return principal.ownerId === sessionOwnerId
}

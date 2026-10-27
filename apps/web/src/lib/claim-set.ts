import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client.ts'
import type { Claim, Span } from '../api/types.ts'

const CLAIM_SET_KEY = ['claim-set'] as const

interface ClaimSet {
  resumeText: string | null
  claims: Claim[]
  spans: Span[]
  confirmed: ReadonlySet<string>
}

async function loadClaimSet(): Promise<ClaimSet> {
  const { resumeText, claims, spans } = await api.claimSet()
  const confirmed = new Set(
    claims.filter((claim) => claim.confirmedByCandidate).map((claim) => claim.id),
  )
  return { resumeText, claims, spans, confirmed }
}

export function useClaimSet() {
  return useQuery({ queryKey: CLAIM_SET_KEY, queryFn: loadClaimSet })
}

export function usePreparation() {
  const cache = useQueryClient()
  const query = useQuery({ queryKey: ['preparation'], queryFn: api.preparation })
  const save = useMutation({
    mutationFn: api.savePreparation,
    onMutate: (selection) => {
      const previous = cache.getQueryData<Awaited<ReturnType<typeof api.preparation>>>([
        'preparation',
      ])
      cache.setQueryData(['preparation'], { selection })
      return { previous }
    },
    onError: (_error, _selection, context) => {
      if (context?.previous !== undefined) cache.setQueryData(['preparation'], context.previous)
    },
    onSuccess: (data) => {
      cache.setQueryData(['preparation'], data)
    },
  })
  return { ...query, save }
}

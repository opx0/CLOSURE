import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { api, apiToken, setApiToken } from '../api/client.ts'
import { Button, Failed, Loading, Panel, Quiet, Tag } from '../components/primitives.tsx'

export function PrivacyPage() {
  const [token, setToken] = useState(apiToken() ?? '')
  const [snapshotId, setSnapshotId] = useState('')
  const promises = useQuery({ queryKey: ['privacy'], queryFn: api.privacy })

  const exported = useMutation({
    mutationFn: api.exportBundle,
    onSuccess: (bundle) => {
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `levelhead-export-${bundle.ownerId}.json`
      link.click()
      URL.revokeObjectURL(url)
    },
  })

  const deleted = useMutation({ mutationFn: () => api.deleteSnapshot(snapshotId) })

  return (
    <div className="space-y-4">
      <Panel
        title="What Levelhead keeps"
        subtitle="Stated here because a promise that is not written down is not a promise."
      >
        {promises.isLoading && <Loading what="the retention promises" />}
        {promises.isError && <Failed error={promises.error} />}
        {promises.data !== undefined && (
          <dl className="space-y-2 text-sm">
            {Object.entries(promises.data).map(([key, value]) => (
              <div key={key}>
                <dt className="text-xs uppercase tracking-wide text-quiet">{key}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        )}
      </Panel>

      <Panel
        title="Export"
        subtitle="Every event, transcript, finding and gap held for you, in the form Levelhead reads."
      >
        <Button tone="primary" onClick={() => exported.mutate()} disabled={exported.isPending}>
          {exported.isPending ? 'building…' : 'Download everything'}
        </Button>
        {exported.isError && (
          <div className="mt-3">
            <Failed error={exported.error} />
          </div>
        )}
      </Panel>

      <Panel
        title="Delete a repository snapshot"
        subtitle="The bytes go. The citation stays as a tombstone, so a past replay reads “snapshot deleted” rather than “citation broken”."
      >
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={snapshotId}
            onChange={(event) => setSnapshotId(event.target.value)}
            placeholder="snapshot_…"
            className="rounded border border-edge bg-[#0f141b] px-2 py-1 text-sm"
          />
          <Button tone="danger" onClick={() => deleted.mutate()} disabled={snapshotId === ''}>
            Delete snapshot
          </Button>
        </div>
        {deleted.isError && (
          <div className="mt-3">
            <Failed error={deleted.error} />
          </div>
        )}
        {deleted.data !== undefined && (
          <p className="mt-3 text-sm text-held">
            deleted {deleted.data.tombstone.snapshotId} at {deleted.data.tombstone.deletedAt}
          </p>
        )}
      </Panel>

      <Panel
        title="Owner token"
        subtitle="Only needed when this server is shared. Stored in this browser, never sent anywhere else."
      >
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={token}
            onChange={(event) => setToken(event.target.value)}
            type="password"
            placeholder="bearer token"
            className="rounded border border-edge bg-[#0f141b] px-2 py-1 text-sm"
          />
          <Button
            onClick={() => {
              setApiToken(token)
              window.location.reload()
            }}
          >
            Save
          </Button>
          <Button
            tone="danger"
            onClick={() => {
              setApiToken(null)
              window.location.reload()
              setToken('')
            }}
          >
            Forget
          </Button>
          <Tag>{apiToken() === null ? 'no token — single-owner mode' : 'token set'}</Tag>
        </div>
        <Quiet>One owner’s sessions are never visible to another, with or without a token.</Quiet>
      </Panel>
    </div>
  )
}

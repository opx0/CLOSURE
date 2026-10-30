import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '../api/client.ts'
import { Failed, Loading, Panel } from '../components/primitives.tsx'

type Design = Awaited<ReturnType<typeof api.designs>>['designs'][number]
const fields = [
  ['title', 'Scenario title', 160],
  ['requirements', 'Requirements', 6000],
  ['estimates', 'Capacity estimates', 4000],
  ['api', 'API and boundaries', 6000],
  ['dataModel', 'Data model', 6000],
  ['diagram', 'Mermaid source (text only)', 6000],
  ['constraint', 'Current constraint to test', 2000],
] as const

function Artifact({ design }: { design: Design }) {
  return (
    <div className="space-y-3 text-sm">
      {fields.map(([name, label]) => (
        <section key={name}>
          <h3 className="font-medium">{label}</h3>
          <pre className="mt-1 whitespace-pre-wrap break-words font-sans text-muted">
            {design[name] || '—'}
          </pre>
        </section>
      ))}
    </div>
  )
}

export function DesignPage() {
  const cache = useQueryClient()
  const designs = useQuery({ queryKey: ['designs'], queryFn: api.designs })
  const [editing, setEditing] = useState<Design | null>(null)
  const [formVersion, setFormVersion] = useState(0)
  const save = useMutation({
    mutationFn: api.saveDesign,
    onSuccess: async () => {
      setEditing(null)
      setFormVersion((value) => value + 1)
      await cache.invalidateQueries({ queryKey: ['designs'] })
    },
  })
  const latest = new Map<string, Design>()
  for (const design of designs.data?.designs ?? [])
    if ((latest.get(design.id)?.revision ?? 0) < design.revision) latest.set(design.id, design)
  const rehearse = (design: Design) =>
    `/session?rounds=system_design&turns=1&designId=${encodeURIComponent(design.id)}&designRevision=${design.revision}`
  return (
    <div className="space-y-4">
      <Panel
        title="System design workspace"
        subtitle="Write a design in text. Each saved revision stays inspectable beside the interview that used it."
      >
        {designs.isLoading && <Loading what="your designs" />}
        {designs.isError && <Failed error={designs.error} />}
        {save.isError && <Failed error={save.error} />}
        <form
          key={editing === null ? `new:${formVersion}` : `${editing.id}:${editing.revision}`}
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            save.mutate({
              ...(editing === null ? {} : { id: editing.id }),
              previousRevision: editing?.revision ?? 0,
              title: String(form.get('title') ?? ''),
              requirements: String(form.get('requirements') ?? ''),
              estimates: String(form.get('estimates') ?? ''),
              api: String(form.get('api') ?? ''),
              dataModel: String(form.get('dataModel') ?? ''),
              diagram: String(form.get('diagram') ?? ''),
              constraint: String(form.get('constraint') ?? ''),
            })
          }}
        >
          {fields.map(([name, label, maxLength]) => (
            <label key={name} className="block text-sm">
              {label}
              {name === 'title' ? (
                <input
                  name={name}
                  required
                  maxLength={maxLength}
                  defaultValue={editing?.[name] ?? ''}
                  className="journey-select mt-2 w-full"
                />
              ) : (
                <textarea
                  name={name}
                  required={name === 'requirements' || name === 'constraint'}
                  maxLength={maxLength}
                  defaultValue={editing?.[name] ?? ''}
                  className="journey-select mt-2 w-full"
                  rows={name === 'requirements' ? 5 : 3}
                />
              )}
            </label>
          ))}
          <button type="submit" disabled={save.isPending} className="journey-primary">
            {editing === null ? 'Save design' : 'Save new revision'}
          </button>
          {editing !== null && (
            <button
              type="button"
              className="ml-3 text-xs underline"
              onClick={() => setEditing(null)}
            >
              Cancel edit
            </button>
          )}
        </form>
      </Panel>
      {[...latest.values()].map((design) => (
        <Panel key={design.id} title={`${design.title} · revision ${design.revision}`}>
          <Artifact design={design} />
          <div className="mt-4 flex gap-4 text-xs">
            <button className="underline" onClick={() => setEditing(design)}>
              Edit design
            </button>
            <Link className="underline" to={rehearse(design)}>
              Rehearse this revision
            </Link>
          </div>
          {design.revision > 1 && (
            <details className="mt-4 text-xs">
              <summary>Earlier revisions</summary>
              {designs.data?.designs
                .filter((entry) => entry.id === design.id && entry.revision < design.revision)
                .map((entry) => (
                  <div key={entry.revision} className="mt-4 border-t border-edge pt-3">
                    <p className="mb-2 font-medium">Revision {entry.revision}</p>
                    <Artifact design={entry} />
                    <Link className="mt-2 inline-block underline" to={rehearse(entry)}>
                      Rehearse revision {entry.revision}
                    </Link>
                  </div>
                ))}
            </details>
          )}
        </Panel>
      ))}
    </div>
  )
}

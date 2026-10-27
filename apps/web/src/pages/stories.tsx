import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '../api/client.ts'
import { Failed, Loading, Panel } from '../components/primitives.tsx'

type Story = Awaited<ReturnType<typeof api.stories>>['stories'][number]

export function StoriesPage() {
  const cache = useQueryClient()
  const stories = useQuery({ queryKey: ['stories'], queryFn: api.stories })
  const [editing, setEditing] = useState<Story | null>(null)
  const [formVersion, setFormVersion] = useState(0)
  const save = useMutation({
    mutationFn: api.saveStory,
    onSuccess: async () => {
      setEditing(null)
      setFormVersion((version) => version + 1)
      await cache.invalidateQueries({ queryKey: ['stories'] })
    },
  })
  const latest = new Map<string, Story>()
  for (const story of stories.data?.stories ?? [])
    if ((latest.get(story.id)?.revision ?? 0) < story.revision) latest.set(story.id, story)
  return (
    <div className="space-y-4">
      <Panel
        title="Your behavioral stories"
        subtitle="Write only what happened. Each saved version is confirmed by you; earlier versions stay available."
      >
        {stories.isLoading && <Loading what="your stories" />}
        {stories.isError && <Failed error={stories.error} />}
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
              situation: String(form.get('situation') ?? ''),
              action: String(form.get('action') ?? ''),
              result: String(form.get('result') ?? ''),
              confirmed: true,
            })
          }}
        >
          {(['situation', 'action', 'result'] as const).map((field) => (
            <label key={field} className="block text-sm capitalize">
              {field[0]!.toUpperCase() + field.slice(1)}
              <textarea
                name={field}
                required
                maxLength={4000}
                defaultValue={editing?.[field] ?? ''}
                className="journey-select mt-2 w-full"
              />
            </label>
          ))}
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" required /> I confirm this story describes my own experience.
          </label>
          <button type="submit" disabled={save.isPending} className="journey-primary">
            {editing === null ? 'Save story' : 'Save new version'}
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
      {[...latest.values()].map((story) => (
        <Panel key={story.id} title={`Story · version ${story.revision}`}>
          <p className="text-sm">
            <strong>Situation:</strong> {story.situation}
          </p>
          <p className="mt-2 text-sm">
            <strong>Action:</strong> {story.action}
          </p>
          <p className="mt-2 text-sm">
            <strong>Result:</strong> {story.result}
          </p>
          <button
            type="button"
            onClick={() => setEditing(story)}
            className="mt-3 text-xs underline"
          >
            Edit story
          </button>
          <Link
            className="ml-4 text-xs underline"
            to={`/session?rounds=behavioral&storyId=${encodeURIComponent(story.id)}&storyRevision=${story.revision}`}
          >
            Rehearse this version
          </Link>
          {story.revision > 1 && (
            <details className="mt-3 text-xs">
              <summary>Earlier versions</summary>
              {stories.data?.stories
                .filter((entry) => entry.id === story.id && entry.revision < story.revision)
                .map((entry) => (
                  <div key={entry.revision} className="mt-3">
                    <p>Version {entry.revision}</p>
                    <p>Situation: {entry.situation}</p>
                    <p>Action: {entry.action}</p>
                    <p>Result: {entry.result}</p>
                    <Link
                      className="underline"
                      to={`/session?rounds=behavioral&storyId=${encodeURIComponent(entry.id)}&storyRevision=${entry.revision}`}
                    >
                      Rehearse version {entry.revision}
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

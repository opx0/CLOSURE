import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { api, type ScreenSimulation } from '../api/client.ts'
import { Button, Empty, Failed, Panel, Quiet, Tag } from '../components/primitives.tsx'

type Flag = ScreenSimulation['flags'][number]
type Coverage = ScreenSimulation['coverage'][number]

function flagLine(flag: Flag): string {
  switch (flag.kind) {
    case 'claim_states_no_outcome':
      return `A claim states no outcome (${flag.claimId}). A screen keys on results; add what happened.`
    case 'claim_verb_is_vague':
      return `A claim leads with a vague verb, "${flag.verb}" (${flag.claimId}). A screen weights concrete verbs.`
    case 'claim_unsupported_by_snapshot':
      return `A claim is not backed by its snapshot (${flag.claimId} · ${flag.snapshotId}).`
    case 'required_term_absent':
      return `A required term the job asks for is absent from your résumé: "${flag.term}".`
  }
}

function CoverageList({
  title,
  terms,
  tone,
}: {
  title: string
  terms: Coverage[]
  tone: 'held' | 'broken'
}) {
  return (
    <div>
      <h3 className="mb-2 text-sm text-body">
        {title} ({terms.length})
      </h3>
      {terms.length === 0 ? (
        <Empty>none</Empty>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {terms.map((term) => (
            <li key={term.term}>
              <Tag tone={tone}>
                {term.term}
                {term.present && term.spanIds.length > 0 ? ` · ${term.spanIds.length} span` : ''}
              </Tag>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function MirrorPage() {
  const [jobDescription, setJobDescription] = useState('')
  const [resumeText, setResumeText] = useState('')

  const mirror = useMutation({
    mutationFn: () => api.mirror({ jobDescription, resumeText }),
  })

  const result = mirror.data
  const present = result?.coverage.filter((term) => term.present) ?? []
  const absent = result?.coverage.filter((term) => !term.present) ?? []

  return (
    <div className="space-y-4">
      <Panel
        title="Screen mirror"
        subtitle="A model of the automated résumé screen on the other side of an application, run against one job description."
      >
        <p className="text-sm text-quiet">
          This simulates what an outside system would extract. It is never a judgment of you, it is
          never an input to one, and by design it produces no match score. The useful output is
          which terms are missing and which claims a screen would flag — both things you can go and
          fix.
        </p>
        <div className="mt-3 space-y-3">
          <label className="block text-xs text-quiet">
            Job description
            <textarea
              value={jobDescription}
              onChange={(event) => setJobDescription(event.target.value)}
              rows={6}
              placeholder="Paste the job description here."
              className="mt-1 w-full rounded-md border border-edge bg-[#0f141b] p-3 text-sm outline-none focus:border-accent/50"
            />
          </label>
          <label className="block text-xs text-quiet">
            Résumé
            <textarea
              value={resumeText}
              onChange={(event) => setResumeText(event.target.value)}
              rows={5}
              placeholder="Paste the same résumé you extracted claims from — it is only used to locate your already-extracted claims, not re-analysed."
              className="mt-1 w-full rounded-md border border-edge bg-[#0f141b] p-3 text-sm outline-none focus:border-accent/50"
            />
          </label>
          <div className="flex items-center gap-3">
            <Button
              tone="primary"
              onClick={() => mirror.mutate()}
              disabled={
                mirror.isPending || jobDescription.trim() === '' || resumeText.trim() === ''
              }
            >
              {mirror.isPending ? 'simulating…' : 'Run the screen'}
            </Button>
            <Quiet>
              Both are treated as untrusted text — scanned for terms, never run as instructions.
            </Quiet>
          </div>
          {mirror.isError && <Failed error={mirror.error} />}
        </div>
      </Panel>

      {result !== undefined && (
        <Panel
          title="What the screen would see"
          subtitle={`job description hash ${result.jobDescriptionHash.slice(0, 12)} · no match score, by design`}
        >
          <div className="space-y-4">
            <CoverageList title="Terms present" terms={present} tone="held" />
            <CoverageList title="Terms absent" terms={absent} tone="broken" />
            <div>
              <h3 className="mb-2 text-sm text-body">Flags ({result.flags.length})</h3>
              {result.flags.length === 0 ? (
                <Empty>Nothing flagged.</Empty>
              ) : (
                <ul className="space-y-1">
                  {result.flags.map((flag, index) => (
                    <li
                      key={index}
                      className="rounded border border-edge bg-[#111720] px-3 py-2 text-sm"
                    >
                      {flagLine(flag)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </Panel>
      )}
    </div>
  )
}

import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client.ts'
import { Failed, Loading, Panel, Quiet, Tag } from '../components/primitives.tsx'
import { words } from '../lib/format.ts'

export function CatalogPage() {
  const actions = useQuery({ queryKey: ['actions'], queryFn: api.actions })
  const personas = useQuery({ queryKey: ['personas'], queryFn: api.personas })
  const rubrics = useQuery({ queryKey: ['rubrics'], queryFn: api.rubrics })
  const roles = useQuery({ queryKey: ['roles'], queryFn: api.roles })
  const formats = useQuery({ queryKey: ['formats'], queryFn: api.formats })

  return (
    <div className="space-y-4">
      <Panel
        title="Policy actions"
        subtitle="Code chooses which of these comes next. The model only turns the chosen intent into a sentence."
      >
        {actions.isLoading && <Loading what="the action set" />}
        {actions.isError && <Failed error={actions.error} />}
        <ul className="space-y-1">
          {actions.data?.actions.map((action) => (
            <li key={action.action} className="rounded border border-edge bg-[#111720] p-2">
              <div className="flex flex-wrap items-center gap-2">
                <Tag tone={action.isPressure ? 'shaky' : 'accent'}>
                  {words(action.action.toLowerCase())}
                </Tag>
                {action.probes !== null && <Tag>probes {words(action.probes)}</Tag>}
                {action.isPressure && (
                  <Tag tone="shaky">pressure move · intensity {action.intensity}</Tag>
                )}
              </div>
              <p className="mt-1 text-xs text-quiet">{action.description}</p>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel
        title="Personas"
        subtitle="A persona is a set of weights on those actions, plus a pressure ceiling."
      >
        {personas.isError && <Failed error={personas.error} />}
        <div className="grid gap-2 sm:grid-cols-2">
          {personas.data?.personas.map((persona) => (
            <div key={persona.id} className="rounded border border-edge bg-[#111720] p-2">
              <div className="flex items-center gap-2">
                <Tag tone="accent">{words(persona.id)}</Tag>
                <Tag>caps pressure at {persona.pressureCeiling}</Tag>
              </div>
              <ul className="mt-1 text-xs text-quiet">
                {Object.entries(persona.actionWeights)
                  .sort(([, left], [, right]) => right - left)
                  .map(([action, weight]) => (
                    <li key={action}>
                      ×{weight} {words(action.toLowerCase())}
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Rubric" subtitle="The same answer meets a different bar at a different level.">
        {rubrics.isError && <Failed error={rubrics.error} />}
        <div className="space-y-3">
          {rubrics.data?.rubrics.map((rubric) => (
            <div key={`${rubric.ref.id}-${rubric.ref.version}`}>
              <h3 className="text-sm text-accent">
                {words(rubric.ref.id)} v{rubric.ref.version}
              </h3>
              <ul className="mt-1 space-y-1">
                {rubric.anchors.map((anchor) => (
                  <li key={anchor.level} className="rounded border border-edge bg-[#111720] p-2">
                    <Tag>{anchor.level}</Tag>
                    <p className="mt-1 text-xs">{anchor.expectation}</p>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Panel>

      <Panel
        title="Roles"
        subtitle="A role pack is data. Whether anyone has measured agreement for it is stated, not implied."
      >
        {roles.isError && <Failed error={roles.error} />}
        <ul className="space-y-1">
          {roles.data?.roles.map((entry) => (
            <li key={entry.pack.id} className="rounded border border-edge bg-[#111720] p-2">
              <div className="flex flex-wrap items-center gap-2">
                <Tag tone="accent">{entry.pack.label}</Tag>
                <Tag tone={entry.pack.validation === 'measured' ? 'held' : 'shaky'}>
                  {entry.pack.validation}
                </Tag>
              </div>
              <p className="mt-1 text-xs text-quiet">{entry.notice}</p>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel
        title="Format presets"
        subtitle="Derived from published guidance, and from nothing else."
      >
        {formats.isError && <Failed error={formats.error} />}
        <ul className="space-y-1">
          {formats.data?.formats.map((format) => (
            <li key={format.id} className="rounded border border-edge bg-[#111720] p-2">
              <Tag tone="accent">{format.label}</Tag>
              <ul className="mt-1 text-xs text-quiet">
                {format.rounds.map((round, index) => (
                  <li key={index}>
                    {words(round.kind)} · {words(round.personaId)} · {round.turns} turns · pressure
                    ≤ {round.pressureCeiling} — {round.emphasis}
                  </li>
                ))}
              </ul>
              <Quiet>{format.disclaimer}</Quiet>
              <ul className="mt-1 text-[11px] text-quiet">
                {format.derivedFrom.map((source) => (
                  <li key={source.url}>
                    {source.publisher} — {source.title} (read {source.readOn})
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  )
}

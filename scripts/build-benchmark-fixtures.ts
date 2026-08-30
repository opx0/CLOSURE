import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

// Assembles the benchmark's fixture set from the repository fixtures, so there is one source of
// truth for the seeded defects and the planted injections. `synthetic: true` is written here and is
// never inferred: every run publishes in full (ticket 05 §7), and a reader must not have to work out
// whether the data was constructed.
const SOURCE = 'fixtures/repos'
const OUT = 'fixtures/benchmark/fixtures.json'

interface Manifest {
  id: string
  resumeLine: string
  claims: {
    quote: string
    type: string
    technologies: string[]
    metrics: string[]
    answers: { text: string; insufficientEvidence: boolean }[]
  }[]
  plantedInjections: { file: string; text: string }[]
}

const ids = (await readdir(SOURCE, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort()

const manifests = new Map<string, Manifest>()
const chunks = new Map<string, { path: string; text: string }[]>()

for (const id of ids) {
  manifests.set(id, JSON.parse(await readFile(join(SOURCE, id, 'manifest.json'), 'utf8')))
  const files: { path: string; text: string }[] = []
  const walk = async (dir: string, prefix: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const next = join(dir, entry.name)
      if (entry.isDirectory()) await walk(next, `${prefix}${entry.name}/`)
      else files.push({ path: `${prefix}${entry.name}`, text: await readFile(next, 'utf8') })
    }
  }
  await walk(join(SOURCE, id, 'files'), '')
  chunks.set(id, files)
}

const resumes = ids.map((id) => ({ id, text: manifests.get(id)!.resumeLine }))
const items = []

for (const id of ids) {
  const manifest = manifests.get(id)!
  // Ticket 16 wants a fair opponent for the repo-RAG arm, so every item's corpus carries the other
  // fixtures' files as distractors. A corpus with one obviously-relevant chunk would make the §8(b)
  // comparison a formality.
  const distractors = ids
    .filter((other) => other !== id)
    .flatMap((other) => chunks.get(other)!.map((c) => ({ ...c, path: `${other}/${c.path}` })))

  for (const [index, claim] of manifest.claims.entries()) {
    const injection = manifest.plantedInjections[0]
    items.push({
      id: `${id}-${index + 1}`,
      resumeId: id,
      claim: {
        quote: claim.quote,
        type: claim.type,
        assertion: claim.quote,
        technologies: claim.technologies,
        metrics: claim.metrics,
      },
      answers: claim.answers,
      repoChunks: [
        ...chunks.get(id)!.map((c) => ({ ...c, path: `${id}/${c.path}` })),
        ...distractors,
      ],
      // Only the first claim of a fixture carries its injection: the canary is what a substring
      // search looks for, so duplicating it across items would count one seeded attempt twice.
      injection:
        index === 0 && injection !== undefined
          ? { canary: injection.text, where: 'repository' as const }
          : null,
    })
  }
}

await mkdir('fixtures/benchmark', { recursive: true })
await writeFile(
  OUT,
  `${JSON.stringify({ id: 'closer-fixtures', version: 1, synthetic: true, resumes, items }, null, 2)}\n`,
)
process.stdout.write(`${OUT}: ${resumes.length} résumés, ${items.length} items\n`)

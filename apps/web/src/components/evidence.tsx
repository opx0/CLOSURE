import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'

interface EvidenceFocus {
  active: readonly string[]
  focus: (quotes: readonly string[]) => void
  clear: () => void
}

const Context = createContext<EvidenceFocus>({ active: [], focus: () => {}, clear: () => {} })

// The product promise is that findings are inspectable, which makes the citation surface a
// requirement rather than polish (STACK §4): hovering a finding highlights the exact words that
// produced it, wherever they appear.
export function EvidenceProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<readonly string[]>([])
  const value = useMemo<EvidenceFocus>(
    () => ({ active, focus: setActive, clear: () => setActive([]) }),
    [active],
  )
  return <Context.Provider value={value}>{children}</Context.Provider>
}

export function useEvidence(): EvidenceFocus {
  return useContext(Context)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function Highlighted({ text, quotes }: { text: string; quotes: readonly string[] }) {
  const wanted = quotes.filter((quote) => quote.trim() !== '')
  if (wanted.length === 0) return <>{text}</>

  const pattern = new RegExp(`(${wanted.map(escapeRegExp).join('|')})`, 'g')
  const parts = text.split(pattern)
  return (
    <>
      {parts.map((part, index) =>
        wanted.includes(part) ? <mark key={`${part}-${index}`}>{part}</mark> : part,
      )}
    </>
  )
}

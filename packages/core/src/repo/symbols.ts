// A locator, not a parser: finds declarations by shape (header, then brace/indent matching) over
// masked source, no syntax tree. Every rule fails toward silence — a *guessed* range would cite code
// the candidate didn't write (§4.8), and missing beats wrong here, every time.

export interface SymbolLocation {
  symbol: string
  // 1-based and inclusive, matching Artifact.startLine/endLine.
  startLine: number
  endLine: number
}

type Language = 'typescript' | 'python' | 'go'

const EXTENSIONS: Readonly<Record<string, Language>> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.js': 'typescript',
  '.jsx': 'typescript',
  '.mjs': 'typescript',
  '.cjs': 'typescript',
  '.py': 'python',
  '.pyi': 'python',
  '.go': 'go',
}

function languageOf(path: string): Language | null {
  const at = path.lastIndexOf('.')
  if (at === -1) return null
  return EXTENSIONS[path.slice(at).toLowerCase()] ?? null
}

// A header that has not opened a body within this many lines is not one this locator understands.
const MAX_HEADER_LINES = 8

// Past this a "function" is a file that lost its closing brace, not a function.
const MAX_BODY_LINES = 2000

interface Masked {
  // Same shape as the source, with string/comment/regex characters replaced by spaces, so a `}`
  // inside a string is never mistaken for a closing brace.
  lines: string[]
  // Whether a line begins inside a construct opened earlier — content, not structure (keeps a
  // Python docstring's un-indented text inside the body).
  continued: boolean[]
}

function maskSource(source: string, language: Language): Masked {
  const out = source.split('')
  const continued: boolean[] = [false]
  let at = 0
  let line = 0
  // Last non-whitespace code character, and the identifier it ends (if any) — together decide
  // whether a `/` opens a regex or divides.
  let lastCode = ''
  let lastWord = ''

  const step = (inside: boolean): void => {
    if (source[at] === '\n') {
      line += 1
      continued[line] = inside
    }
    at += 1
  }

  const blank = (inside: boolean): void => {
    if (source[at] !== '\n') out[at] = ' '
    step(inside)
  }

  const blankToEndOfLine = (): void => {
    while (at < source.length && source[at] !== '\n') blank(false)
  }

  const blankQuoted = (quote: string): void => {
    blank(false)
    while (at < source.length && source[at] !== '\n') {
      const char = source[at]
      // An unterminated quote is broken code; stopping at end-of-line keeps the damage local.
      if (char === '\\') {
        blank(false)
        if (at < source.length && source[at] !== '\n') blank(false)
        continue
      }
      blank(false)
      if (char === quote) return
    }
  }

  const blankUntil = (terminator: string, escapes: boolean): void => {
    while (at < source.length) {
      if (escapes && source[at] === '\\') {
        blank(true)
        if (at < source.length) blank(true)
        continue
      }
      if (source.startsWith(terminator, at)) {
        for (let n = 0; n < terminator.length; n += 1) blank(true)
        return
      }
      blank(true)
    }
  }

  const blankTemplate = (): void => {
    blank(true)
    let interpolation = 0
    while (at < source.length) {
      const char = source[at]
      if (char === '\\') {
        blank(true)
        if (at < source.length) blank(true)
        continue
      }
      if (interpolation === 0 && char === '`') {
        blank(true)
        return
      }
      if (interpolation === 0 && char === '$' && source[at + 1] === '{') {
        blank(true)
        blank(true)
        interpolation = 1
        continue
      }
      if (interpolation > 0) {
        if (char === '{') interpolation += 1
        else if (char === '}') interpolation -= 1
      }
      blank(true)
    }
  }

  const regexAllowedHere = (): boolean => {
    if (lastCode === '') return true
    // After a value, a slash divides; after an operator or one of these keywords, it opens a pattern.
    if (/[A-Za-z0-9_$)\]]/.test(lastCode)) return REGEX_KEYWORDS.has(lastWord)
    return true
  }

  const regexEnd = (): number => {
    let scan = at + 1
    let inClass = false
    while (scan < source.length) {
      const char = source[scan]
      if (char === '\n') return -1
      if (char === '\\') {
        scan += 2
        continue
      }
      if (inClass) {
        if (char === ']') inClass = false
      } else if (char === '[') {
        inClass = true
      } else if (char === '/') {
        scan += 1
        while (scan < source.length && /[a-z]/.test(source[scan] ?? '')) scan += 1
        return scan
      }
      scan += 1
    }
    return -1
  }

  while (at < source.length) {
    const char = source[at] ?? ''
    const next = source[at + 1] ?? ''

    if (language !== 'python' && char === '/' && next === '/') {
      blankToEndOfLine()
      continue
    }
    if (language !== 'python' && char === '/' && next === '*') {
      blank(true)
      blank(true)
      blankUntil('*/', false)
      continue
    }
    if (language === 'python' && char === '#') {
      blankToEndOfLine()
      continue
    }
    if (language === 'python' && (source.startsWith('"""', at) || source.startsWith("'''", at))) {
      const fence = source.slice(at, at + 3)
      for (let n = 0; n < 3; n += 1) blank(true)
      blankUntil(fence, true)
      continue
    }
    if (language === 'typescript' && char === '`') {
      blankTemplate()
      continue
    }
    if (language === 'go' && char === '`') {
      blank(true)
      blankUntil('`', false)
      continue
    }
    if (char === '"' || char === "'") {
      blankQuoted(char)
      continue
    }
    if (language === 'typescript' && char === '/' && regexAllowedHere()) {
      const end = regexEnd()
      if (end !== -1) {
        while (at < end) blank(false)
        continue
      }
    }

    if (!/\s/.test(char)) {
      lastCode = char
      lastWord = /[A-Za-z0-9_$]/.test(char) ? lastWord + char : ''
    }
    step(false)
  }

  return { lines: out.join('').split('\n'), continued }
}

const REGEX_KEYWORDS = new Set([
  'return',
  'typeof',
  'instanceof',
  'in',
  'of',
  'new',
  'delete',
  'void',
  'throw',
  'case',
  'do',
  'else',
  'yield',
  'await',
])

interface Header {
  indent: string
  symbol: string
  // Where the body search starts — a `{` inside the signature's own parens isn't mistaken for the body.
  searchCol: number
}

// `function name(` and `function name<` — after `function name` a `<` can only open generics.
const TS_FUNCTION =
  /^(\s*)(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*[(<]/
const TS_CLASS =
  /^(\s*)(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)\b/
// No `<`: `const a = b < c` is a comparison this locator can't tell from generics.
const TS_ASSIGNED =
  /^(\s*)(?:export\s+)?(?:declare\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]*?)?=\s*(?:async\s+)?(?:function\s*\*?\s*(?:[A-Za-z_$][\w$]*)?\s*)?\(/
// The loosest of the four patterns, so it leans hardest on the corroboration below.
const TS_METHOD =
  /^(\s*)(?:(?:public|private|protected|static|abstract|override|readonly|async|get|set)\s+)*\*?\s*([A-Za-z_$][\w$]*)\s*\(/

// Control flow wears the same shape as a call: `if (…) {` looks like a name, parens, then a brace.
const NOT_A_SYMBOL = new Set([
  'if',
  'for',
  'while',
  'switch',
  'catch',
  'return',
  'new',
  'await',
  'typeof',
  'delete',
  'void',
  'throw',
  'yield',
  'else',
  'do',
  'case',
  'in',
  'of',
  'instanceof',
  'import',
  'export',
  'function',
  'class',
  'const',
  'let',
  'var',
  'super',
  'this',
])

const GO_FUNC = /^(\s*)func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*(?:\[[^\]]*\]\s*)?\(/
const GO_TYPE = /^(\s*)type\s+([A-Za-z_]\w*)\s+(?:struct|interface)\s*\{/

function headerAt(text: string, language: Language): Header | null {
  const patterns =
    language === 'go' ? [GO_FUNC, GO_TYPE] : [TS_FUNCTION, TS_CLASS, TS_ASSIGNED, TS_METHOD]
  for (const pattern of patterns) {
    const match = pattern.exec(text)
    const indent = match?.[1]
    const symbol = match?.[2]
    if (match === null || indent === undefined || symbol === undefined) continue
    if (NOT_A_SYMBOL.has(symbol)) return null
    // One before the end so the `(`, `<` or `{` the pattern consumed is seen by the body search.
    return { indent, symbol, searchCol: Math.max(match[0].length - 1, indent.length) }
  }
  return null
}

interface Position {
  line: number
  col: number
}

function findBodyOpen(lines: readonly string[], from: Position): Position | null {
  let depth = 0
  const until = Math.min(lines.length, from.line + MAX_HEADER_LINES)
  for (let line = from.line; line < until; line += 1) {
    const text = lines[line] ?? ''
    for (let col = line === from.line ? from.col : 0; col < text.length; col += 1) {
      const char = text[col]
      if (char === '(' || char === '[') depth += 1
      else if (char === ')' || char === ']') {
        depth -= 1
        if (depth < 0) return null
      } else if (depth === 0 && char === '{') return { line, col }
      // A signature that ends without a body: an overload, an interface member, an abstract method.
      else if (depth === 0 && (char === ';' || char === '}')) return null
    }
  }
  return null
}

function findBodyClose(lines: readonly string[], open: Position): number | null {
  let depth = 0
  const until = Math.min(lines.length, open.line + MAX_BODY_LINES)
  for (let line = open.line; line < until; line += 1) {
    const text = lines[line] ?? ''
    for (let col = line === open.line ? open.col : 0; col < text.length; col += 1) {
      if (text[col] === '{') depth += 1
      else if (text[col] === '}') {
        depth -= 1
        if (depth === 0) return line
      }
    }
  }
  return null
}

// Second opinion on the brace count: a declaration's body closes at the declaration's own
// indentation. A closing brace found anywhere else means the count was thrown off by a masking
// mistake, so the range is discarded rather than reported.
function corroborates(
  lines: readonly string[],
  headerLine: number,
  indent: string,
  endLine: number,
): boolean {
  const text = lines[endLine] ?? ''
  if (endLine === headerLine) return /\}[)\];,]*\s*$/.test(text)
  const body = text.trimStart()
  return body.startsWith('}') && text.slice(0, text.length - body.length) === indent
}

function braceSymbols(masked: Masked, language: Language): SymbolLocation[] {
  const found: SymbolLocation[] = []
  for (let line = 0; line < masked.lines.length; line += 1) {
    if (masked.continued[line] === true) continue
    const header = headerAt(masked.lines[line] ?? '', language)
    if (header === null) continue
    const open = findBodyOpen(masked.lines, { line, col: header.searchCol })
    if (open === null) continue
    const end = findBodyClose(masked.lines, open)
    if (end === null) continue
    if (!corroborates(masked.lines, line, header.indent, end)) continue
    found.push({ symbol: header.symbol, startLine: line + 1, endLine: end + 1 })
  }
  return found
}

const PY_DEF = /^(\s*)(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/
const PY_CLASS = /^(\s*)class\s+([A-Za-z_]\w*)\s*[(:]/

function indentOf(text: string): number {
  return text.length - text.trimStart().length
}

// Python's body is its indentation: the end is the last line still indented past the header, with
// two exceptions — a wrapped signature (tracked by paren depth) and a docstring line (any column).
function pythonSymbols(masked: Masked, source: readonly string[]): SymbolLocation[] {
  const found: SymbolLocation[] = []
  for (let line = 0; line < masked.lines.length; line += 1) {
    if (masked.continued[line] === true) continue
    const text = masked.lines[line] ?? ''
    const match = PY_DEF.exec(text) ?? PY_CLASS.exec(text)
    const indent = match?.[1]
    const symbol = match?.[2]
    if (match === null || indent === undefined || symbol === undefined) continue

    const headerEnd = pythonHeaderEnd(masked.lines, line, match[0].length - 1)
    if (headerEnd === null) continue

    let end = headerEnd
    for (let scan = headerEnd + 1; scan < masked.lines.length; scan += 1) {
      const raw = source[scan] ?? ''
      if (raw.trim() === '') continue
      if (masked.continued[scan] !== true && indentOf(raw) <= indent.length) break
      end = scan
    }
    found.push({ symbol, startLine: line + 1, endLine: end + 1 })
  }
  return found
}

// The line the signature's `:` lands on — a `def` whose colon isn't found within the lookahead is
// not reported.
function pythonHeaderEnd(lines: readonly string[], from: number, col: number): number | null {
  let depth = 0
  const until = Math.min(lines.length, from + MAX_HEADER_LINES)
  for (let line = from; line < until; line += 1) {
    const text = lines[line] ?? ''
    for (let scan = line === from ? col : 0; scan < text.length; scan += 1) {
      const char = text[scan]
      if (char === '(' || char === '[' || char === '{') depth += 1
      else if (char === ')' || char === ']' || char === '}') depth -= 1
      else if (depth === 0 && char === ':') return line
    }
  }
  return null
}

export function extractSymbols(path: string, source: string): SymbolLocation[] {
  const language = languageOf(path)
  if (language === null) return []
  const masked = maskSource(source, language)
  const found =
    language === 'python'
      ? pythonSymbols(masked, source.split('\n'))
      : braceSymbols(masked, language)
  return found.sort((a, b) => a.startLine - b.startLine || a.endLine - b.endLine)
}

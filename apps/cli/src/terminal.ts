import { createInterface } from 'node:readline'
import { stdin, stdout } from 'node:process'

const BOLD = '\x1b[1m'
const DIM = '\x1b[2m'
const RESET = '\x1b[0m'

export function heading(text: string): void {
  stdout.write(`\n${BOLD}${text}${RESET}\n`)
}

export function line(text = ''): void {
  stdout.write(`${text}\n`)
}

export function dim(text: string): void {
  stdout.write(`${DIM}${text}${RESET}\n`)
}

export function quote(text: string): void {
  for (const part of text.split('\n')) stdout.write(`${DIM}  │ ${part}${RESET}\n`)
}

// One shared source for the whole process — a fresh readline per question would drop buffered input.
let source: AsyncIterator<string> | null = null

function lines(): AsyncIterator<string> {
  source ??= createInterface({ input: stdin, crlfDelay: Infinity })[Symbol.asyncIterator]()
  return source
}

// `null` at end of input — `readline/promises`' `question()` never settles when a pipe closes.
async function readLine(): Promise<string | null> {
  const { value, done } = await lines().next()
  return done === true ? null : (value as string)
}

export async function ask(prompt: string): Promise<string> {
  stdout.write(`${prompt} `)
  return (await readLine())?.trim() ?? ''
}

// A blank line ends the answer — forcing it onto one line would change what the candidate says.
export async function askParagraph(prompt: string): Promise<string> {
  if (prompt !== '') stdout.write(`${prompt}\n`)
  stdout.write(`${DIM}(end with a blank line)${RESET}\n`)
  const collected: string[] = []
  for (;;) {
    stdout.write('> ')
    const next = await readLine()
    if (next === null || next.trim() === '') break
    collected.push(next)
  }
  return collected.join('\n').trim()
}

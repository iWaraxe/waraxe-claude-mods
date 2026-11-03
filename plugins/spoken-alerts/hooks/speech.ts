// Pure helpers: turn markdown, tool calls and question dialogs into short lines to speak.

// The synthesizer reads symbols aloud: drop control characters, code, link targets and markdown marks.
const CONTROL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f‪-‮⁦-⁩]/g
export function forSpeech(raw: string, max = 300) {
  const text = raw
    .replace(CONTROL, '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, 'a link')
    .replace(/[*_#>|~]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (text.length <= max) return text
  const cut = text.lastIndexOf(' ', max - 1)
  return `${text.slice(0, cut > 0 ? cut : max)}…`
}

export function firstSentence(raw: string, max = 200) {
  const text = forSpeech(raw, 2000)
  return forSpeech(text.split(/(?<=[.!?])\s/)[0] ?? text, max)
}

// A folder name as words: waraxe-claude-mods → waraxe claude mods.
export const spokenName = (name: string) => name.replace(/[-_.]+/g, ' ').trim()

// a, b, or c
export function orList(items: readonly string[]) {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')}, or ${items[items.length - 1]}`
}

const RECOMMENDED = /\s*\(recommended\)\s*/i

export type Choice = { label: string; description?: string }

// The option marked "(Recommended)", its mark taken off; null when none is marked.
export function recommendedOf(options: readonly Choice[]) {
  const pick = options.find(o => RECOMMENDED.test(o.label))
  return pick ? forSpeech(pick.label.replace(RECOMMENDED, ' '), 80) : null
}

export type Question = { question: string; options: readonly Choice[] }

// The question, then the recommended option, or the options when none is recommended.
export function questionLine(q: Question) {
  const pick = recommendedOf(q.options)
  const options = q.options.map(o => forSpeech(o.label.replace(RECOMMENDED, ' '), 80))
  return `${forSpeech(q.question, 300)} ${pick ? `Recommended: ${pick}.` : `Options: ${orList(options)}.`}`
}

export function dialogLines(where: string, questions: readonly Question[]) {
  if (questions.length === 1) return [`Question from ${where}.`, questionLine(questions[0]!)]
  return [`${questions.length} questions from ${where}.`, ...questions.map((q, i) => `Question ${i + 1}. ${questionLine(q)}`)]
}

// What a permission prompt asks for, from the tool and its input.
export function permissionLine(tool: string, input: unknown) {
  if (tool === 'ExitPlanMode') return 'Claude has a plan for you to approve.'
  return `Claude asks to ${permissionAsk(tool, input)}.`
}

function permissionAsk(tool: string, input: unknown) {
  const i = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const str = (k: string) => (typeof i[k] === 'string' ? (i[k] as string) : '')
  const file = (p: string) => p.split('/').filter(Boolean).pop() ?? p
  if (tool === 'Bash') return str('description') ? `run a command: ${forSpeech(str('description'), 120)}` : 'run a command'
  if (tool === 'Edit' || tool === 'Write' || tool === 'NotebookEdit') {
    const path = str('file_path') || str('notebook_path')
    return path ? `change ${spokenName(file(path))}` : 'change a file'
  }
  if (tool === 'WebFetch') {
    const host = /^https?:\/\/([^/]+)/.exec(str('url'))?.[1]
    return host ? `fetch a page from ${host}` : 'fetch a web page'
  }
  if (tool === 'WebSearch') return 'search the web'
  const mcp = /^mcp__(.+?)__(.+)$/.exec(tool)
  if (mcp) return `use ${spokenName(mcp[2]!)} from ${spokenName(mcp[1]!)}`
  return `use ${spokenName(tool)}`
}

// The desktop app's own label for a next-step button that runs one of its actions.
const ACTIONS: Record<string, string> = {
  commit: 'Commit',
  create_pr: 'Create pull request',
  merge: 'Merge',
  fix_ci: 'Fix CI',
  address_comments: 'Address comments',
  resolve_conflicts: 'Resolve conflicts',
  verify: 'Verify',
  archive: 'Archive',
  new_session: 'New session',
}

// The first button of the next-step box: the recommendation.
export function firstAction(actions: unknown) {
  const first = Array.isArray(actions) ? (actions[0] as Record<string, unknown> | undefined) : undefined
  if (!first) return null
  if (typeof first.action === 'string') return ACTIONS[first.action] ?? spokenName(first.action)
  return typeof first.label === 'string' && first.label.trim() !== '' ? forSpeech(first.label, 80) : null
}

// Haiku's JSON reply, tolerating a code fence around it.
export function parseDone(text: string): { topic: string; done: string } | null {
  try {
    const o = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) as Record<string, unknown>
    const done = typeof o.done === 'string' ? forSpeech(o.done, 240) : ''
    if (!done) return null
    return { topic: typeof o.topic === 'string' ? forSpeech(o.topic, 60) : '', done }
  } catch {
    return null
  }
}

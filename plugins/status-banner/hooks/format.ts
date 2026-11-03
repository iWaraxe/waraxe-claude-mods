// Pure helpers for the banner: number and time formats, the plan windows, ping prices
// and the model replies the summary row and heads-up read.
import type { PlanWindow, Summary } from '../types'

export const usd = (n: number) => `$${n.toFixed(2)}`

const pad = (n: number) => String(n).padStart(2, '0')

// The cache countdown: 58:40.
export const mmss = (seconds: number) => `${pad(Math.floor(seconds / 60))}:${pad(seconds % 60)}`

// A coarse span: 4m, 1h08, 2d3h; under a minute is `now`. From usage-meter (Hamza Zafar, MIT).
export function countdown(ms: number) {
  const minutes = Math.max(0, Math.ceil(ms / 60_000))
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h${pad(minutes % 60)}`
  return `${Math.floor(hours / 24)}d${hours % 24}h`
}

// A bar of `cells` cells for the terminal, five by default: ▮▮▯▯▯.
export function textBar(percent: number, cells = 5) {
  const filled = Math.round((Math.min(Math.max(percent, 0), 100) / 100) * cells)
  return '▮'.repeat(filled) + '▯'.repeat(cells - filled)
}

// Plan usage: green under 75%, yellow from 75%, red from 90%.
export function planColor(percent: number) {
  if (percent >= 90) return 'red'
  if (percent >= 75) return 'yellow'
  return 'green'
}

const LABELS: Record<string, string> = { five_hour: '5h', seven_day: '7d', spend_limit: 'spend' }
const ORDER = ['five_hour', 'seven_day', 'spend_limit']

export const planLabel = (kind: string) => LABELS[kind] ?? kind.replace(/_/g, ' ')

export function resetTime(w: PlanWindow) {
  const ms = w.resetsAt ? Date.parse(w.resetsAt) : NaN
  return Number.isFinite(ms) ? ms : 0
}

// The windows to draw, in order: one past its reset waits for a fresh reading.
export function liveWindows(windows: readonly PlanWindow[], now: number) {
  const rank = (kind: string) => {
    const i = ORDER.indexOf(kind)
    return i < 0 ? ORDER.length : i
  }
  return windows
    .filter(w => {
      const reset = resetTime(w)
      return reset === 0 || reset > now
    })
    .sort((a, b) => rank(a.kind) - rank(b.kind))
}

// $ per million tokens, [cache read, 1h cache write, output], list prices October 2026.
// More specific families first: a model id takes the first row it matches.
// The table and pingUsd are from cache-tax (Karan Bansal, MIT).
const PRICES: Array<[string | RegExp, number, number, number]> = [
  ['fable-5-1', 0.25, 20, 50],
  ['mythos-5-1', 0.25, 20, 50],
  ['fable-5', 1, 20, 50],
  ['mythos-5', 1, 20, 50],
  ['opus-5-5', 0.2, 8, 20],
  ['opus-5', 0.5, 10, 25],
  // Opus 4 and 4.1 in every spelling, never Opus 4.5 and later.
  [/opus-4(?:-[01])?(?:$|[^-\d]|-20\d{6})/, 1.5, 30, 75],
  ['opus-4', 0.5, 10, 25],
  ['sonnet-5-5', 0.1, 4, 10],
  ['sonnet-5', 0.2, 4, 10],
  ['sonnet', 0.3, 6, 15],
  ['haiku-5-5', 0.01, 0.2, 0.5],
  ['3-5-haiku', 0.08, 1.6, 4],
  ['haiku-3-5', 0.08, 1.6, 4],
  ['haiku', 0.1, 2, 5],
]

// A request whose prompt, cache reads and writes included, is over 100k tokens pays these instead.
const LONG_PRICES: Array<[string, number, number, number]> = [['haiku-5-5', 0.05, 1, 2.5]]
const LONG_PROMPT_TOKENS = 100000

type Usage = { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }

function priceOf(model: string, promptTokens: number): [number, number, number] | null {
  const m = model.toLowerCase().replace(/[\s.]+/g, '-')
  if (promptTokens > LONG_PROMPT_TOKENS) {
    for (const [family, read, write, output] of LONG_PRICES) if (m.includes(family)) return [read, write, output]
  }
  for (const [family, read, write, output] of PRICES) {
    if (typeof family === 'string' ? m.includes(family) : family.test(m)) return [read, write, output]
  }
  return null
}

// What one ping cost: the cache read, any cache write, uncached input at the base rate
// (half the 1h write rate) and the output; null for a model with no price here.
export function pingUsd(model: string, u: Usage): number | null {
  const price = priceOf(model, u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens)
  if (!price) return null
  return (u.cache_read_input_tokens * price[0] + u.cache_creation_input_tokens * price[1] + (u.input_tokens * price[1]) / 2 + u.output_tokens * price[2]) / 1e6
}

// The engine refuses a band with a control character in it: drop escape sequences, control
// characters and bidi overrides. From where-am-i (Hamza Zafar, MIT).
const ESCAPES = /\x1b(?:\[[0-?]*[ -/]*[@-~]|[\]PX^_][\s\S]*?(?:\x07|\x1b\\|$)|[@-Z\\-_])|\x9b[0-?]*[ -/]*[@-~]|[\x90\x98\x9d\x9e\x9f][\s\S]*?(?:\x07|\x9c|$)|[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f‪-‮⁦-⁩]/g
export function clean(text: string) {
  return text.replace(ESCAPES, '')
}

// One sentence of at most `max` characters, cut at a word: the model does not always keep to the limit.
export function clip(raw: string, max = 70) {
  const text = clean(raw).replace(/\s+/g, ' ').trim()
  const first = text.split(/(?<=[.!?])\s/)[0] ?? text
  if (first.length <= max) return first.replace(/\.$/, '')
  return `${first.slice(0, first.lastIndexOf(' ', max - 1))}…`
}

// The summary's JSON, tolerating a code fence around it; null without a goal.
export function parseSummary(text: string): Summary | null {
  const body = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)
  try {
    const o = JSON.parse(body) as Record<string, unknown>
    const field = (k: string) => (typeof o[k] === 'string' ? clip((o[k] as string).replace(/\s*—\s*/g, ', ')) : '')
    if (!field('goal')) return null
    return { goal: field('goal'), next: field('next'), waiting: field('waiting') }
  } catch {
    return null
  }
}

// The heads-up check's JSON array, at most two flags; [] on anything else. From heads-up.
export function parseFlags(text: string): string[] {
  try {
    const list: unknown = JSON.parse(text.match(/\[[\s\S]*\]/)?.[0] ?? '[]')
    return Array.isArray(list)
      ? list.filter((f): f is string => typeof f === 'string' && f.trim() !== '').slice(0, 2).map(f => clean(f).trim())
      : []
  } catch {
    return []
  }
}

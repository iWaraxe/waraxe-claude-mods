import type { EngineInterface, ModelEffort, Register } from 'claude-code'

import { LEVELS, SYSTEM, isLevel, lineFor, optionsFor, parseReply, promptFor, questionFor, submitLevel } from './pick'
import type { Recommendation } from './pick'

// effort-picker: Haiku recommends an effort for each prompt, and the prompt waits on its first
// model request, where the session's real level is known. Two things show the choice, because no
// one place does both on the desktop app: a question dialog takes Enter, and a banner row holds
// the five levels. A click in the row answers the dialog in its place, which closes it.

const HEADER = 'Effort'
const HAIKU_MS = 8_000
const EARLIER_MS = 1_000

// Where a prompt the person wrote comes from: the prompt box, the Remote Control bridge, an SDK host.
const PERSON: ReadonlySet<string> = new Set(['composer', 'bridge', 'sdk'])

type Row = { from: ModelEffort; rec: Recommendation | null; target: ModelEffort }
// The turn that answers a prompt, and the level it runs at once chosen.
type Bound = { turnId: string; text: string; level?: ModelEffort }

// All of it starts over when the module reloads; a prompt caught by that keeps the person's level.
let waiting: string[] = []
let bound: Bound | null = null
let row: Row | null = null
let clicked: ((choice: string) => void) | null = null
// What the banner answered, for `choose` to read once the dialog's call has ended.
let lastClick: string | null = null

function press(choice: string) {
  clicked?.(choice)
}

/** Haiku's recommendation, or null when it fails or names no level. */
async function recommend($: EngineInterface, text: string): Promise<Recommendation | null> {
  const messages = await $.session.messages().catch(() => [])
  const earlier = messages.filter(one => one.role === 'assistant' && one.text !== '').at(-1)?.text
  const r = await $.model.complete({ model: 'haiku', system: SYSTEM, prompt: promptFor(text, earlier), maxTokens: 40, effort: 'low', timeoutMs: HAIKU_MS })

  return r.isAnswered ? parseReply(r.text) : null
}

/** Shows the choice and waits for it: the level this turn runs at. */
async function choose($: EngineInterface, text: string, from: ModelEffort): Promise<ModelEffort> {
  const rec = await recommend($, text)
  const target = submitLevel(from, rec)
  row = { from, rec, target }
  $.ui.invalidate('ui.render')

  try {
    // Dismissed, or nobody to ask: the person's own level stands.
    const answer = await $.ui.ask(questionFor(from, rec), { header: HEADER, options: optionsFor(target) }).catch((err: unknown) => err)
    const choice = typeof answer === 'string' ? answer : lastClick
    const to = choice === 'Submit' ? target : isLevel(choice ?? '') ? (choice as ModelEffort) : from
    const line = lineFor(from, to, rec, choice !== 'Submit' && choice !== null)
    if (line !== null) $.ui.log(line)

    return to
  } finally {
    row = null
    lastClick = null
    $.ui.invalidate('ui.render')
  }
}

export const register: Register = on => {
  on('prompt.submit', async ($, e, next) => {
    const isPicked = PERSON.has(e.origin.kind) && e.command === undefined && e.isMeta !== true && e.turnId === undefined
    if (!isPicked) return next(e)

    waiting = [...waiting.slice(-4), e.text]
    const result = await next(e)
    // A dropped prompt starts no turn; one a hook beneath rewrote starts its turn with the new text.
    waiting = result.drop !== undefined ? waiting.filter(one => one !== e.text) : waiting.map(one => (one === e.text ? result.text : one))

    return result
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      const text = waiting.find(one => one === e.text)
      waiting = waiting.filter(one => one !== text)
      bound = text === undefined ? null : { turnId: e.turnId, text }
    }

    return next(e)
  })

  // Each model request of the turn: the main chat's alone, never a subagent's.
  on('turn.step', async function* ($, e, next) {
    const now = bound
    if (e.agentId !== undefined || now === null || now.turnId !== e.turnId || typeof e.effort !== 'string') {
      return yield* next(e)
    }

    if (e.index === 0) {
      // A -p run has no surface and nobody to press anything.
      if ((await $.session.surfaces()).length === 0) return yield* next(e)
      now.level = await choose($, now.text, e.effort)
    }

    // Only this request carries the level; the saved setting is never written.
    return yield* next(now.level === undefined ? e : { ...e, effort: now.level })
  })

  // The dialog and a banner click race. A click answers here, which closes the dialog.
  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) => {
    if (row === null || e.questions[0]?.header !== HEADER) return next(e)

    const byClick = new Promise<string>(resolve => {
      clicked = resolve
    })
    const first = await Promise.race([next(e).then(answered => ({ answered })), byClick.then(choice => ({ choice }))])
    clicked = null
    if ('answered' in first) return first.answered
    lastClick = first.choice

    return { deny: `Picked ${first.choice} in the banner.` }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const rest = await next(e)
    const shown = row
    if (shown === null) return rest

    const { Box, Button, Text } = $.ui.resolve(e)
    const isReal = rest !== null && rest !== undefined && (rest as { type?: unknown }).type !== 'engine'

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          <Text dimColor>effort</Text>
          {LEVELS.map(level => (
            <Button
              key={`level:${level}`}
              label={level === shown.from ? `${level} (now)` : level}
              variant={level === shown.rec?.level ? 'primary' : 'secondary'}
              onPress={() => press(level)}
            />
          ))}
          <Button key="submit" label="Submit" onPress={() => press('Submit')} />
        </Box>
        {isReal ? rest : null}
      </Box>
    )
  })
}

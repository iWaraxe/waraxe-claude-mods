import { describe, expect, mock, test } from 'claude-code/testing'
import type { ModelCompleteResult, ModelForkResult, On, RenderPropsOf, SessionRateLimit } from 'claude-code'
import type { Engine, MockClock } from 'claude-code/testing'

const MIN = 60_000
const HOUR = 60 * MIN
const START = Date.parse('2026-10-30T10:00:00Z')
const SURFACES = ['terminal', 'desktop'] as const

const band = (bodyColumns = 140, over: Partial<RenderPropsOf['AbovePrompt']> = {}) => ({
  plugin: 'status-banner',
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns, scroll: { offset: 0, bodyRows: 12 }, view: {}, ...over },
})

const SUMMARY = '{"goal":"fix band rows","next":"fix replay","waiting":"go-ahead"}'
const FLAGS = '["npm test failed and the reply does not say so"]'
const warmPing: ModelForkResult = {
  isAnswered: true,
  text: 'warm',
  usage: { input_tokens: 2, output_tokens: 1, cache_read_input_tokens: 200_000, cache_creation_input_tokens: 100 },
}
const failedPing: ModelForkResult = {
  isAnswered: false,
  reason: 'api-error',
  status: 529,
  error: 'overloaded',
  usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
}

// The engine beneath the mod: its figures, a step that streams `tokens` over two seconds,
// Haiku's replies and a fork answering from a script. `beneath` is what other bands draw.
function world(on: On, clock: MockClock, beneath: 'band' | 'engine' = 'band') {
  const w = {
    usd: 5.94,
    percent: 26,
    rateLimits: [] as SessionRateLimit[],
    tokens: 186,
    forks: [] as ModelForkResult[],
    forked: 0,
    completions: [] as string[],
    toasts: [] as string[],
  }
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('session.usage', () => ({
    value: { startedAt: START, context: { window: 200_000, tokens: 52_000, percent: w.percent }, rateLimits: w.rateLimits, cost: { usd: w.usd } },
  }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.cwd', () => ({ value: '/work' }))
  on('session.messages', () => ({
    value: [
      { role: 'user' as const, text: 'fix the band rows', toolUses: [] },
      { role: 'assistant' as const, text: 'Fixed. Shall I fix replay next?', toolUses: [] },
    ],
  }))
  on('session.compact', (_$, e) => ({ messages: e.messages }))
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  on('tool.call', () => ({ result: {}, text: 'ok' }) as never)
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.step', async function* (_$, e) {
    yield { kind: 'text' as const, index: 0, text: 'Fixed.' }
    await clock.advance(2000)
    const usage = { input_tokens: 2, output_tokens: w.tokens, cache_read_input_tokens: 50_000, cache_creation_input_tokens: 2_000, model: 'claude-opus-5-5' }
    yield { kind: 'stop' as const, stopReason: 'end_turn' as const, usage }
    return { turnId: e.turnId, index: e.index, answer: 'Fixed.', toolUses: [], stopReason: 'end_turn' as const, usage }
  })
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('model.complete', (_$, e) => {
    w.completions.push(e.system ? 'summary' : 'heads-up')
    const value: ModelCompleteResult = { isAnswered: true, text: e.system ? SUMMARY : FLAGS, usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } }
    return { value }
  })
  on('model.fork', () => {
    w.forked++
    return { value: w.forks.shift() ?? warmPing }
  })
  on('ui.toast', (_$, e) => {
    w.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.render', ($, e) => (beneath === 'engine' ? ({ type: 'engine', ref: 0 } as never) : $.ui.resolve(e).Text({ children: 'beneath band' })))
  return w
}

// One main-thread turn: it costs $0.14 and its reply streams `tokens` over two seconds.
async function turn($: Engine, w: { usd: number }, id: string, answer = 'Fixed.') {
  await $.turn.start({ turnId: id, text: 'go' })
  w.usd += 0.14
  for await (const _ of $.turn.step({ turnId: id, index: 0, model: 'claude-opus-5-5', messageCount: 4 })) {
    // Read to the end, as the engine does.
  }
  await $.turn.complete({ turnId: id, answer, durationMs: 2000, isAborted: false, reason: 'answer' })
}

async function start($: Engine) {
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
}

const text = async (ui: { find: (q: { type: string; text: RegExp }) => Promise<{ text: string } | undefined> }, pattern: RegExp) =>
  (await ui.find({ type: 'Text', text: pattern }))?.text

describe('session row', () => {
  test('shows turn, speed, both costs, the cache countdown and context after the first answer', async ($, on) => {
    const clock = mock.clock(on, { now: START })
    const w = world(on, clock)
    await start($)

    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...band(), surface })
      expect(await ui.find({ key: 'keep-warm' })).toBeUndefined()
      expect(await text(ui, /^Turn/)).toBeUndefined()
      await ui.unmount()
    }

    await turn($, w, 't1')
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...band(), surface })
      expect(await text(ui, /^Turn/)).toBe('Turn')
      expect(await text(ui, /^1$/)).toBe('1')
      expect(await text(ui, /tok\/s/)).toBe('93 tok/s')
      expect(await text(ui, /^\$0\.14$/)).toBe('$0.14')
      expect(await text(ui, /^\$6\.08$/)).toBe('$6.08')
      expect(await text(ui, /^60:00$/)).toBe('60:00')
      expect((await ui.find({ key: 'keep-warm' }))?.props.label).toBe('Keep warm')
      expect(await text(ui, /^26%$/)).toBe('26%')
      // Icons on the desktop, words on the terminal.
      expect(await text(ui, /^cache$/)).toBe(surface === 'terminal' ? 'cache' : undefined)
      expect((await ui.find({ type: 'Svg' })) !== undefined).toBe(surface === 'desktop')
      await ui.unmount()
    }
  })

  test('shows the row while the first turn still runs, its cost live', async ($, on) => {
    const clock = mock.clock(on, { now: START })
    world(on, clock)
    await start($)

    await $.turn.start({ turnId: 't1', text: 'go' })
    for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 4 })) {
      // Read to the end, as the engine does.
    }
    // The engine's measurement mid-turn: the turn has cost $0.14 so far.
    await $.session.measure({ context: { window: 200_000, tokens: 52_000, percent: 26 }, rateLimits: [], cost: { usd: 6.08 }, changed: ['cost'] })

    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...band(140, { isWorking: true }), surface })
      expect(await text(ui, /^1$/)).toBe('1')
      expect(await text(ui, /tok\/s/)).toBe('93 tok/s')
      expect(await text(ui, /^\$0\.14$/)).toBe('$0.14')
      expect(await text(ui, /^\$6\.08$/)).toBe('$6.08')
      expect(await text(ui, /^…$/)).toBe('…')
      expect(await text(ui, /^26%$/)).toBe('26%')
      await ui.unmount()
    }
  })

  test('draws session-band’s look at body size: bold figures, 22px icons, no dots, context at the end', async ($, on) => {
    const clock = mock.clock(on, { now: START })
    const w = world(on, clock)
    await start($)
    await turn($, w, 't1')

    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...band(), surface })
      for (const p of [/^1$/, /^93 tok\/s$/, /^\$0\.14$/, /^\$6\.08$/, /^60:00$/, /^26%$/]) {
        const found = await ui.find({ type: 'Text', text: p })
        expect(found?.props.bold).toBe(true)
        // session-band's own size: no larger step.
        expect(found?.props.size).toBeUndefined()
      }
      expect(await ui.find({ type: 'Text', text: /^ · $/ })).toBeUndefined()
      await ui.unmount()
    }

    const ui = await $.ui.mount({ ...band(), surface: 'desktop' })
    const svgs = await ui.findAll({ type: 'Svg' })
    for (const alt of ['speed', 'cost', 'cache', 'context']) expect(svgs.find(s => s.props.alt === alt)?.props.width).toBe(22)
    expect(svgs.find(s => s.props.alt === 'context 26%')?.props.width).toBe(80)
    await ui.unmount()
  })

  test('keeps every session field in a 72-column desktop band, with Keep warm on too', async ($, on) => {
    const clock = mock.clock(on, { now: START })
    const w = world(on, clock)
    await start($)
    await turn($, w, 't1')
    const all = [/^Turn$/, /^93 tok\/s$/, /^\$0\.14$/, /^\$6\.08$/, /^60:00$/, /^26%$/]

    const ui = await $.ui.mount({ ...band(72), surface: 'desktop' })
    for (const p of all) expect(await text(ui, p)).toBeDefined()
    expect((await ui.find({ key: 'keep-warm' }))?.props.label).toBe('Keep warm')

    // Its long label while on shrinks first, so no field drops for it.
    await ui.press({ key: 'keep-warm' })
    expect((await ui.find({ key: 'keep-warm' }))?.props.label).toBe('◷ 2h00')
    for (const p of all) expect(await text(ui, p)).toBeDefined()
    await ui.unmount()
  })

  test('the countdown turns amber at 20 minutes, red at 10, then reads expired', { timeoutMs: 60_000 }, async ($, on) => {
    const clock = mock.clock(on, { now: START })
    const w = world(on, clock)
    await start($)
    await turn($, w, 't1')
    const ui = await $.ui.mount({ ...band(), surface: 'terminal' })

    await clock.advance(39 * MIN)
    expect((await ui.find({ type: 'Text', text: /^21:00$/ }))?.props.color).toBeUndefined()
    await clock.advance(2 * MIN)
    expect((await ui.find({ type: 'Text', text: /^19:00$/ }))?.props.color).toBe('#e2a94e')
    await clock.advance(10 * MIN)
    expect((await ui.find({ type: 'Text', text: /^09:00$/ }))?.props.color).toBe('#e0846b')
    await clock.advance(10 * MIN)
    expect(await text(ui, /^expired$/)).toBe('expired')
    // Nothing is left to keep warm.
    expect(await ui.find({ key: 'keep-warm' })).toBeUndefined()
    await ui.unmount()
  })
})

describe('plan row', () => {
  test('shows 5-hour and 7-day usage, the 5-hour reset and the spend limit from a measurement', async ($, on) => {
    const clock = mock.clock(on, { now: START })
    const w = world(on, clock)
    await start($)
    const at = (ms: number) => new Date(START + ms).toISOString()
    await $.session.measure({
      context: { window: 200_000 },
      rateLimits: [
        { kind: 'seven_day', percentUsed: 76, resetsAt: at(50 * HOUR) },
        { kind: 'five_hour', percentUsed: 8, resetsAt: at(68 * MIN) },
        { kind: 'spend_limit', percentUsed: 40 },
      ],
      cost: { usd: 1 },
      changed: ['rateLimits'],
    })

    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...band(), surface })
      expect((await ui.find({ type: 'Text', text: /^8%$/ }))?.props.color).toBe('green')
      expect(await text(ui, /^resets/)).toBe('resets 1h08')
      expect((await ui.find({ type: 'Text', text: /^76%$/ }))?.props.color).toBe('yellow')
      expect(await text(ui, /^spend$/)).toBe('spend')
      expect(await text(ui, /^40%$/)).toBe('40%')
      // Three windows share the row in whole-percent parts: the engine refuses a fractional one.
      expect((await ui.findAll({ type: 'Box' })).filter(b => b.props.width === '33%')).toHaveLength(3)
      // The plan row shows before any answer; the session row does not.
      expect(await ui.find({ key: 'keep-warm' })).toBeUndefined()
      await ui.unmount()
    }

    // A window past its reset waits for a fresh reading.
    await clock.advance(70 * MIN)
    const ui = await $.ui.mount({ ...band(), surface: 'terminal' })
    expect(await text(ui, /^8%$/)).toBeUndefined()
    expect(await text(ui, /^76%$/)).toBe('76%')
    await ui.unmount()
    expect(w.toasts).toEqual([])
  })

  test('splits into a 5h part and a 7d part, each bar stretched to fill its part', async ($, on) => {
    const clock = mock.clock(on, { now: START })
    const w = world(on, clock)
    w.rateLimits = [
      { kind: 'five_hour', percentUsed: 8, resetsAt: new Date(START + 68 * MIN).toISOString() },
      { kind: 'seven_day', percentUsed: 13 },
    ]
    await start($)
    await turn($, w, 't1')

    for (const columns of [140, 72]) {
      const ui = await $.ui.mount({ ...band(columns), surface: 'desktop' })
      expect((await ui.findAll({ type: 'Box' })).filter(b => b.props.width === '50%')).toHaveLength(2)
      const svgs = await ui.findAll({ type: 'Svg' })
      const five = Number(svgs.find(s => s.props.alt === '5h 8%')?.props.width)
      const seven = Number(svgs.find(s => s.props.alt === '7d 13%')?.props.width)
      // The 7-day part has no reset time beside its bar, so its bar is the longer.
      expect(five).toBeGreaterThan(columns === 140 ? 300 : 80)
      expect(seven).toBeGreaterThan(five)
      expect(await text(ui, /^resets/)).toBe('resets 1h08')
      await ui.unmount()
    }

    // The terminal fills its part with a text bar to the cell.
    const ui = await $.ui.mount({ ...band(140), surface: 'terminal' })
    // The context bar beside 26% is five cells; the plan's are longer.
    const bars = (await ui.findAll({ type: 'Text', text: /^[▮▯]{6,}$/ })).map(t => t.text.length)
    expect(bars.length).toBe(2)
    expect(Math.min(...bars)).toBeGreaterThan(30)
    await ui.unmount()
  })

  test('a window past 90% toasts once', async ($, on) => {
    const clock = mock.clock(on, { now: START })
    const w = world(on, clock)
    await start($)
    const reading = { kind: 'five_hour', percentUsed: 91, resetsAt: new Date(START + HOUR).toISOString() }
    await $.session.measure({ context: { window: 200_000 }, rateLimits: [reading], changed: ['rateLimits'] })
    await $.session.measure({ context: { window: 200_000 }, rateLimits: [{ ...reading, percentUsed: 93 }], changed: ['rateLimits'] })
    expect(w.toasts).toEqual(['5h usage limit at 91%, resets in 1h00'])
    const ui = await $.ui.mount({ ...band(), surface: 'terminal' })
    expect((await ui.find({ type: 'Text', text: /^93%$/ }))?.props.color).toBe('red')
    await ui.unmount()
  })
})

describe('summary row and heads-up', () => {
  test('one Haiku call per turn draws goal, next and what waits on you', async ($, on) => {
    const clock = mock.clock(on, { now: START })
    const w = world(on, clock)
    await start($)
    await turn($, w, 't1')
    await clock.settle()

    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...band(), surface })
      expect(await text(ui, /fix band rows/)).toBeDefined()
      // where-am-i's label: a teal diamond.
      const label = await ui.find({ type: 'Text', text: /^◆ Goal: $/ })
      expect(label?.props.color).toBe('cyan')
      expect(label?.props.bold).toBe(true)
      expect(await text(ui, /next:/)).toBeDefined()
      expect(await text(ui, /waiting on you:/)).toBeDefined()
      await ui.unmount()
    }
    expect(w.completions).toEqual(['summary'])

    // The next turn clears what waited on the person.
    await $.turn.start({ turnId: 't2', text: 'go' })
    const ui = await $.ui.mount({ ...band(), surface: 'terminal' })
    expect(await text(ui, /waiting on you:/)).toBeUndefined()
    await ui.unmount()
  })

  test('the summary row is off with its option', { options: { summaryRow: false } }, async ($, on) => {
    const clock = mock.clock(on, { now: START })
    const w = world(on, clock)
    await start($)
    await turn($, w, 't1')
    await clock.settle()
    const ui = await $.ui.mount({ ...band(), surface: 'terminal' })
    expect(await text(ui, /fix band rows/)).toBeUndefined()
    await ui.unmount()
    expect(w.completions).toEqual([])
  })

  test('after a long turn past the third prompt, heads-up flags what was missed until dismissed', async ($, on) => {
    const clock = mock.clock(on, { now: START })
    const w = world(on, clock)
    await start($)
    for (const p of ['one', 'two', 'three', 'four']) await $.prompt.submit({ text: p, wait: false, origin: { kind: 'composer' } })
    await $.turn.start({ turnId: 't1', text: 'four' })
    await $.tool.call({ tool: 'Bash', command: 'npm test' } as never)
    await $.turn.complete({ turnId: 't1', answer: 'Done. '.repeat(60), durationMs: 90_000, isAborted: false, reason: 'answer' })
    await clock.settle()

    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...band(), surface })
      expect(await text(ui, /npm test failed/)).toBeDefined()
      expect(await ui.find({ key: 'dismiss' })).toBeDefined()
      await ui.unmount()
    }
    expect(w.completions.sort()).toEqual(['heads-up', 'summary'])

    const ui = await $.ui.mount({ ...band(), surface: 'terminal' })
    await ui.press({ key: 'dismiss' })
    expect(await text(ui, /npm test failed/)).toBeUndefined()
    await ui.unmount()
  })

  test('heads-up is off with its option', { options: { headsUp: false } }, async ($, on) => {
    const clock = mock.clock(on, { now: START })
    const w = world(on, clock)
    await start($)
    for (const p of ['one', 'two', 'three', 'four']) await $.prompt.submit({ text: p, wait: false, origin: { kind: 'composer' } })
    await $.turn.start({ turnId: 't1', text: 'four' })
    await $.tool.call({ tool: 'Bash', command: 'npm test' } as never)
    await $.turn.complete({ turnId: 't1', answer: 'Done. '.repeat(60), durationMs: 90_000, isAborted: false, reason: 'answer' })
    await clock.settle()
    expect(w.completions).toEqual(['summary'])
  })
})

describe('the band', () => {
  test('keeps the row another mod draws beneath it', async ($, on) => {
    const clock = mock.clock(on, { now: START })
    const w = world(on, clock)
    await start($)
    await turn($, w, 't1')
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...band(), surface })
      expect(await ui.find({ key: 'keep-warm' })).toBeDefined()
      expect(await text(ui, /beneath band/)).toBe('beneath band')
      await ui.unmount()
    }
  })

  test('leaves out Claude Code’s placeholder when nothing is drawn beneath it', async ($, on) => {
    const clock = mock.clock(on, { now: START })
    const w = world(on, clock, 'engine')
    await start($)
    await turn($, w, 't1')
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...band(), surface })
      expect(await ui.find({ key: 'keep-warm' })).toBeDefined()
      expect(JSON.stringify(await ui.drawn())).not.toContain('"engine"')
      await ui.unmount()
    }
  })

  test('yields to a survey', async ($, on) => {
    const clock = mock.clock(on, { now: START })
    const w = world(on, clock)
    await start($)
    await turn($, w, 't1')
    const ui = await $.ui.mount({ ...band(140, { hasSurvey: true }), surface: 'terminal' })
    expect(await ui.find({ key: 'keep-warm' })).toBeUndefined()
    expect(await text(ui, /beneath band/)).toBe('beneath band')
    await ui.unmount()
  })

  test('a narrow window drops the lower-priority fields first', async ($, on) => {
    const clock = mock.clock(on, { now: START })
    const w = world(on, clock)
    await start($)
    w.rateLimits = [
      { kind: 'five_hour', percentUsed: 8, resetsAt: new Date(START + 68 * MIN).toISOString() },
      { kind: 'seven_day', percentUsed: 13 },
    ]
    await turn($, w, 't1')
    await clock.settle()

    const wide = await $.ui.mount({ ...band(140), surface: 'terminal' })
    for (const p of [/^Turn$/, /tok\/s/, /^\$0\.14$/, /^resets/, /fix band rows/, /▮/]) expect(await text(wide, p)).toBeDefined()
    await wide.unmount()

    // Priority 4 (turn, summary) and 3 (speed, turn cost, reset) drop; bars go; Keep warm becomes an icon.
    const narrow = await $.ui.mount({ ...band(40), surface: 'terminal' })
    for (const p of [/^Turn/, /tok\/s/, /^\$0\.14$/, /^resets/, /fix band rows/, /▮/]) expect(await text(narrow, p)).toBeUndefined()
    for (const p of [/^8%$/, /^13%$/, /^\$6\.08$/, /^\d\d:\d\d$/, /^26%$/]) expect(await text(narrow, p)).toBeDefined()
    expect((await narrow.find({ key: 'keep-warm' }))?.props.label).toBe('◷')
    await narrow.unmount()

    // Narrower still, priority 2 goes too: only 5-hour usage and the cache countdown stay.
    const tiny = await $.ui.mount({ ...band(24), surface: 'terminal' })
    for (const p of [/^13%$/, /^\$6\.08$/, /^26%$/]) expect(await text(tiny, p)).toBeUndefined()
    for (const p of [/^8%$/, /^\d\d:\d\d$/]) expect(await text(tiny, p)).toBeDefined()
    await tiny.unmount()
  })
})

describe('keep warm', () => {
  test('one press pings 50 minutes after the last request, shows the cost, and stops after 2 hours', { timeoutMs: 60_000 }, async ($, on) => {
    const clock = mock.clock(on, { now: START })
    const w = world(on, clock)
    await start($)
    await turn($, w, 't1')
    const ui = await $.ui.mount({ ...band(), surface: 'terminal' })
    await ui.press({ key: 'keep-warm' })
    expect((await ui.find({ key: 'keep-warm' }))?.props.label).toBe('warm · 2h00 left · next ping 50m')

    await clock.advance(49 * MIN)
    expect(w.forked).toBe(0)
    await clock.advance(MIN + 1000)
    expect(w.forked).toBe(1)
    // The ping read the chat from the cache: its countdown starts again.
    expect(await text(ui, /^60:00$|^59:59$/)).toBeDefined()
    expect(await text(ui, /^last ping/)).toBe('last ping $0.04')

    await clock.advance(50 * MIN)
    expect(w.forked).toBe(2)
    // The third would fall after the window: none goes out, and the button comes back.
    await clock.advance(25 * MIN)
    expect((await ui.find({ key: 'keep-warm' }))?.props.label).toBe('Keep warm')
    await clock.advance(HOUR)
    expect(w.forked).toBe(2)
    // Once the window ended, the last ping's cache ran out with the usual warnings.
    expect(w.toasts).toEqual(['⏳ work: Prompt cache expires in 10 min', '⏳ work: Prompt cache expires in 5 min'])
    await ui.unmount()
  })

  test('a turn running when a ping is due holds it, and its end starts the 50 minutes again', { timeoutMs: 60_000 }, async ($, on) => {
    const clock = mock.clock(on, { now: START })
    const w = world(on, clock)
    await start($)
    await turn($, w, 't1')
    const ui = await $.ui.mount({ ...band(), surface: 'terminal' })
    await ui.press({ key: 'keep-warm' })
    await clock.advance(49 * MIN)
    await $.turn.start({ turnId: 't2', text: 'go' })
    await clock.advance(3 * MIN)
    expect(w.forked).toBe(0)
    await $.turn.complete({ turnId: 't2', answer: 'ok', durationMs: 3 * MIN, isAborted: false, reason: 'answer' })
    await clock.advance(49 * MIN)
    expect(w.forked).toBe(0)
    await clock.advance(MIN + 1000)
    expect(w.forked).toBe(1)
    await ui.unmount()
  })

  test('a second press turns it off', { timeoutMs: 60_000 }, async ($, on) => {
    const clock = mock.clock(on, { now: START })
    const w = world(on, clock)
    await start($)
    await turn($, w, 't1')
    const ui = await $.ui.mount({ ...band(), surface: 'terminal' })
    await ui.press({ key: 'keep-warm' })
    await ui.press({ key: 'keep-warm' })
    expect((await ui.find({ key: 'keep-warm' }))?.props.label).toBe('Keep warm')
    await clock.advance(55 * MIN)
    expect(w.forked).toBe(0)
    await ui.unmount()
  })

  test('three failed pings in a row stop it', { timeoutMs: 60_000 }, async ($, on) => {
    const clock = mock.clock(on, { now: START })
    const w = world(on, clock)
    w.forks = [failedPing, failedPing, failedPing]
    await start($)
    await turn($, w, 't1')
    const ui = await $.ui.mount({ ...band(), surface: 'terminal' })
    await ui.press({ key: 'keep-warm' })
    // At 50 minutes, then 2.5 and 5 minutes later.
    await clock.advance(56 * MIN)
    expect(w.forked).toBe(3)
    expect(w.toasts[0]).toBe('Keep warm stopped: 3 pings in a row failed')
    expect((await ui.find({ key: 'keep-warm' }))?.props.label).toBe('Keep warm')
    await ui.unmount()
  })

  test('/clear and compaction stop it', { timeoutMs: 60_000 }, async ($, on) => {
    const clock = mock.clock(on, { now: START })
    const w = world(on, clock)
    await start($)
    await turn($, w, 't1')
    let ui = await $.ui.mount({ ...band(), surface: 'terminal' })
    await ui.press({ key: 'keep-warm' })
    await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'summary', toolUses: [] }] })
    expect(w.toasts).toEqual(['Keep warm stopped: the chat was compacted'])
    await ui.unmount()

    await turn($, w, 't2')
    ui = await $.ui.mount({ ...band(), surface: 'terminal' })
    await ui.press({ key: 'keep-warm' })
    await $.session.end({ reason: 'clear', sessionId: 'S1', resume: { id: 'S1' } })
    // A new conversation: no session row until its first turn.
    expect(await ui.find({ key: 'keep-warm' })).toBeUndefined()
    await clock.advance(55 * MIN)
    expect(w.forked).toBe(0)
    await ui.unmount()
  })

  test('with a 5-minute cache it pings 50 seconds before expiry', { options: { cacheLifetime: '5m' } }, async ($, on) => {
    const clock = mock.clock(on, { now: START })
    const w = world(on, clock)
    await start($)
    await turn($, w, 't1')
    const ui = await $.ui.mount({ ...band(), surface: 'terminal' })
    expect(await text(ui, /^05:00$/)).toBe('05:00')
    await ui.press({ key: 'keep-warm' })
    await clock.advance(4 * MIN)
    expect(w.forked).toBe(0)
    await clock.advance(11_000)
    expect(w.forked).toBe(1)
    await ui.unmount()
  })
})

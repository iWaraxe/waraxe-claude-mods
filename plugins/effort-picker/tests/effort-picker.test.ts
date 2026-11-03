import { describe, expect, test } from 'claude-code/testing'
import type { ModelCompleteResult, ModelEffort, On, RenderPropsOf } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { lineFor, optionsFor, parseReply, questionFor, submitLevel } from '../hooks/pick'

const USAGE = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const band = (surface: 'terminal' | 'desktop') => ({
  plugin: 'effort-picker',
  component: 'AbovePrompt' as const,
  surface,
  props: { hasSurvey: false, isWorking: true, maxRows: 12, bodyColumns: 140, scroll: { offset: 0, bodyRows: 12 }, view: {} } as unknown as RenderPropsOf['AbovePrompt'],
})

type World = { reply: string | null; sent: unknown[]; asked: { question: string; options: string[] }[]; logged: string[]; answer: string | null | 'wait'; surfaces: string[] }

// The engine beneath the mod: Haiku's reply, the dialog's answer, what each model request carried.
function world(on: On, over: Partial<World> = {}): World {
  const w: World = { reply: 'medium: a clear scoped change', sent: [], asked: [], logged: [], answer: 'Submit', surfaces: ['desktop'], ...over }
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  on('session.surfaces', () => ({ value: w.surfaces }) as never)
  on('session.messages', () => ({ value: [] }) as never)
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.step', async function* (_$, e) {
    w.sent.push(e.effort)
    return { turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [], stopReason: 'end_turn' as const, usage: USAGE }
  })
  on('model.complete', () => {
    const value: ModelCompleteResult = w.reply === null ? { isAnswered: false, reason: 'empty-reply', usage: USAGE } : { isAnswered: true, text: w.reply, usage: USAGE }
    return { value }
  })
  on('tool.call', { tool: 'AskUserQuestion' }, async (_$, e) => {
    const q = e.questions[0]
    w.asked.push({ question: q.question, options: q.options.map(o => o.label) })
    if (w.answer === 'wait') await new Promise(() => undefined)
    if (w.answer === null) return { deny: 'dismissed' } as never
    return { result: { questions: e.questions, answers: { [q.question]: w.answer } } } as never
  })
  on('ui.log', (_$, e) => {
    w.logged.push(e.text)
    return { value: undefined } as never
  })
  on('ui.render', () => ({ type: 'engine', ref: 0 }) as never)
  return w
}

async function send($: Engine, id: string, effort: ModelEffort | number | undefined, text = 'add a settings page', origin = { kind: 'composer' }, steps = 2) {
  await $.prompt.submit({ text, origin, wait: false } as never)
  await $.turn.start({ turnId: id, text })
  for (let index = 0; index < steps; index++) {
    for await (const _ of $.turn.step({ turnId: id, index, model: 'claude-opus-5-5', messageCount: 2, effort } as never)) {
      // Read to the end, as the engine does.
    }
  }
}

describe('Enter', () => {
  test('on low, medium or high it applies the recommendation to the whole turn', async ($, on) => {
    const w = world(on)
    await send($, 't1', 'high')
    expect(w.sent).toEqual(['medium', 'medium'])
    expect(w.asked[0].question).toBe('Haiku recommends medium: a clear scoped change. Send at medium?')
    expect(w.logged).toEqual(['Effort picker: medium for this message, down from high: a clear scoped change.'])
  })

  for (const from of ['xhigh', 'max'] as const) {
    test(`on ${from} it keeps the level and leaves one line about the tip`, async ($, on) => {
      const w = world(on)
      await send($, 't1', from)
      expect(w.sent).toEqual([from, from])
      expect(w.logged).toEqual([`Effort picker: kept ${from}. Haiku suggested medium: a clear scoped change.`])
    })
  }

  test('the next turn is asked again', async ($, on) => {
    const w = world(on)
    await send($, 't1', 'high')
    await send($, 't2', 'high', 'and another')
    expect(w.asked).toHaveLength(2)
  })
})

describe('the choices', () => {
  test('a level taken in the dialog wins, from any level', async ($, on) => {
    const w = world(on, { answer: 'low' })
    await send($, 't1', 'xhigh')
    expect(w.sent).toEqual(['low', 'low'])
    expect(w.logged).toEqual(['Effort picker: low for this message, down from xhigh, your pick.'])
  })

  test('a dismissed dialog keeps the level', async ($, on) => {
    const w = world(on, { answer: null })
    await send($, 't1', 'high')
    expect(w.sent).toEqual(['high', 'high'])
  })

  test('a banner click closes the dialog and sends at that level', async ($, on) => {
    const w = world(on, { answer: 'wait' })
    for (const surface of ['terminal', 'desktop'] as const) {
      const id = `t-${surface}`
      const sending = send($, id, 'xhigh', surface)
      let ui = await $.ui.mount(band(surface))
      let row = await ui.find({ key: 'level:medium' })
      for (let tries = 0; row === undefined && tries < 50; tries++) {
        await ui.unmount()
        await $.session.surfaces()
        ui = await $.ui.mount(band(surface))
        row = await ui.find({ key: 'level:medium' })
      }
      expect(row?.props.variant).toBe('primary')
      expect((await ui.find({ key: 'level:xhigh' }))?.props.label).toBe('xhigh (now)')
      await ui.press({ key: 'level:medium' })
      await sending
      await ui.unmount()
      const after = await $.ui.mount(band(surface))
      expect(await after.find({ key: 'level:medium' })).toBeUndefined()
      await after.unmount()
    }
    expect(w.sent).toEqual(['medium', 'medium', 'medium', 'medium'])
  })
})

describe('left alone', () => {
  test('a slash command, a plugin prompt and a number budget are not asked', async ($, on) => {
    const w = world(on)
    await send($, 't1', 'high', 'from a plugin', { kind: 'plugin', name: 'x' })
    await send($, 't2', 3000)
    await $.prompt.submit({ text: '/x', origin: { kind: 'composer' }, wait: false, command: { name: 'x' } } as never)
    expect(w.asked).toEqual([])
  })

  test('a run with no surface goes straight through', async ($, on) => {
    const w = world(on, { surfaces: [] })
    await send($, 't1', 'high')
    expect(w.asked).toEqual([])
    expect(w.sent).toEqual(['high', 'high'])
  })

  test('Haiku failing still shows the choice, and Enter keeps the level', async ($, on) => {
    const w = world(on, { reply: null })
    await send($, 't1', 'high')
    expect(w.asked[0].question).toBe('Haiku gave no recommendation. Keep high?')
    expect(w.sent).toEqual(['high', 'high'])
  })
})

describe('pick', () => {
  test('reads a reply, and refuses one with no level', () => {
    expect(parseReply('XHIGH: a broad refactor\nmore')).toEqual({ level: 'xhigh', why: 'a broad refactor' })
    expect(parseReply('**low** - quick')).toEqual({ level: 'low', why: 'quick' })
    expect(parseReply('I think so')).toBeNull()
  })

  test('Enter never lowers xhigh or max, and never raises them either', () => {
    expect(submitLevel('xhigh', { level: 'max', why: '' })).toBe('xhigh')
    expect(submitLevel('low', { level: 'max', why: '' })).toBe('max')
  })

  test('Submit comes first, then three levels', () => {
    expect(optionsFor('medium')).toEqual(['Submit', 'low', 'high', 'xhigh'])
    expect(optionsFor('max')).toEqual(['Submit', 'medium', 'high', 'xhigh'])
    expect(questionFor('xhigh', { level: 'low', why: '' })).toBe('Haiku recommends low. Keep xhigh?')
  })

  test('nothing to say when the level did not move and Haiku agreed', () => {
    expect(lineFor('high', 'high', { level: 'high', why: 'x' }, false)).toBeNull()
  })
})

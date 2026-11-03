// The sound mute (audio.play, audio.speak, and process.run for say and afplay) is not covered
// here: a test's own hooks may not call $.audio or $.process, so nothing in the kit can stand for
// another mod making a sound. It is checked in a real session instead; see EXPLANATION.md.
import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100 } as never,
} as const

const FLAG = '/home/u/.claude/mods-data/rec-mode/state.json'

type Engine = Parameters<Parameters<typeof test>[1]>[0]

// Stands for the engine beneath the mod: no .env files, a home folder, and `beneath` for the band.
function engine(on: On, beneath: (ui: { Text: (props: object) => unknown }) => unknown = () => ({ type: 'engine', ref: 0 })) {
  const files: Record<string, string> = {}
  const toasts: string[] = []
  const clock = mock.clock(on, { now: 1000 })
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? '/home/u' : undefined }) as never)
  on('session.cwd', () => ({ value: '/repo' }) as never)
  on('session.start', (_, e) => ({ cwd: e.cwd }) as never)
  on('command.register', (_, e) => ({ value: { command: e.name } }) as never)
  on('fs.exists', (_, e) => ({ value: e.path in files }) as never)
  on('fs.read', (_, e) => ({ value: files[e.path] ?? '' }) as never)
  on('fs.write', (_, e) => ((files[e.path] = e.text), { value: undefined }) as never)
  on('ui.toast', (_, e) => (toasts.push(e.text), { value: undefined }) as never)
  on('ui.render', ($, e) => beneath($.ui.resolve(e) as never) as never)
  return { files, toasts, clock }
}

async function start($: Engine) {
  await $.session.start({ source: 'startup', cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
}

async function rec($: Engine, args = '') {
  await $.command.run({ command: 'rec', args } as never)
}

async function badge($: Engine) {
  const ui = await $.ui.mount({ plugin: 'rec-mode', surface: 'terminal', ...BAND })
  const drawn = JSON.stringify(await ui.drawn())
  await ui.unmount()
  return drawn
}

test('the REC badge keeps the bands drawn beneath it', async ($, on) => {
  engine(on, ui => ui.Text({ children: 'beneath band' }))
  await start($)
  await rec($)

  const ui = await $.ui.mount({ plugin: 'rec-mode', surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Text', text: /● REC/ })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /beneath band/ }))?.text).toBe('beneath band')
  await ui.unmount()
})

test('the REC badge leaves out Claude Code’s placeholder when nothing is drawn beneath it', async ($, on) => {
  // With no band beneath, next(e) answers Claude Code's own drawing of the band.
  engine(on)
  await start($)
  await rec($)

  const ui = await $.ui.mount({ plugin: 'rec-mode', surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Text', text: /● REC/ })).toBeDefined()
  expect(JSON.stringify(await ui.drawn())).not.toContain('"engine"')
  await ui.unmount()
})

test('/rec turns REC on with a red badge that says mod sounds are off, and /rec off turns it off', async ($, on) => {
  const { files, toasts } = engine(on)
  await start($)

  await rec($)
  expect(JSON.parse(files[FLAG]).on).toBe(true)
  expect(await badge($)).toContain('● REC')
  expect(await badge($)).toContain('masked · mod sounds off')
  expect(toasts.at(-1)).toBe('REC on: screen masked, mod sounds off.')

  await rec($, 'off')
  expect(JSON.parse(files[FLAG]).on).toBe(false)
  expect(await badge($)).toContain('○ REC')
  expect(toasts.at(-1)).toBe('REC off. Mod sounds are back on.')
})

test('a grey ○ REC shows while off, and pressing it turns REC on', async ($, on) => {
  const { files } = engine(on)
  await start($)

  const ui = await $.ui.mount({ plugin: 'rec-mode', surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Text', text: /● REC/ })).toBeUndefined()
  expect(JSON.stringify(await ui.drawn())).toContain('○ REC')
  await ui.press({ key: 'rec-switch' })
  await ui.unmount()

  expect(JSON.parse(files[FLAG]).on).toBe(true)
  expect(await badge($)).toContain('● REC')
})

test('Stop on the red badge turns REC off', async ($, on) => {
  const { files } = engine(on)
  await start($)
  await rec($, 'strict')
  expect(await badge($)).toContain('strict mask · mod sounds off')

  const ui = await $.ui.mount({ plugin: 'rec-mode', surface: 'terminal', ...BAND })
  await ui.press({ key: 'rec-switch' })
  await ui.unmount()

  expect(JSON.parse(files[FLAG]).on).toBe(false)
  expect(await badge($)).toContain('○ REC')
})

test('on desktop the badge is the pulsing REC image with Stop, and ○ REC while off', async ($, on) => {
  engine(on)
  await start($)

  const off = await $.ui.mount({ plugin: 'rec-mode', surface: 'desktop', ...BAND })
  expect(await off.find({ type: 'Button', key: 'rec-switch' })).toBeDefined()
  expect(JSON.stringify(await off.drawn())).toContain('○ REC')
  await off.press({ key: 'rec-switch' })
  await off.unmount()

  const live = await $.ui.mount({ plugin: 'rec-mode', surface: 'desktop', ...BAND })
  const drawn = JSON.stringify(await live.drawn())
  expect(drawn).toContain('"alt":"REC"')
  expect(drawn).toContain('mod sounds off')
  expect(drawn).toContain('Stop')
  await live.unmount()
})

test('a switch written by bin/rec shows within one 3-second poll', async ($, on) => {
  const { files, clock } = engine(on)
  await start($)

  files[FLAG] = '{"on":true,"strict":false,"since":1000}'
  await clock.advance(3000)
  expect(await badge($)).toContain('● REC')

  files[FLAG] = '{"on":false,"strict":false,"since":0}'
  await clock.advance(3000)
  expect(await badge($)).toContain('○ REC')
})

test('a half-written flag file leaves REC on', async ($, on) => {
  const { files, clock } = engine(on)
  await start($)
  await rec($)

  files[FLAG] = '{"on":fa'
  await clock.advance(3000)
  expect(await badge($)).toContain('● REC')
})

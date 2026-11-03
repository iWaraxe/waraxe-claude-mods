import { describe, expect, mock, test } from 'claude-code/testing'
import type { ModelCompleteResult, On } from 'claude-code'
import type { Engine, MockClock } from 'claude-code/testing'

const START = Date.parse('2026-10-31T10:00:00Z')
const USAGE = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const DONE = '{"topic":"spoken alerts","done":"Built the spoken alerts mod and its tests."}'

type Fetched = { url: string; headers: Record<string, string>; body: Record<string, unknown> }

// The engine beneath the mod: a project folder, Haiku's reply, a voice API's answer, and a log of
// every clip, utterance and toast.
function world(
  on: On,
  over: { haiku?: string | null; missingVoice?: string; api?: { status: number; text: string }; env?: Record<string, string>; files?: Record<string, string> } = {},
) {
  const w = { heard: [] as string[], prompts: [] as string[], fetched: [] as Fetched[], toasts: [] as string[], read: [] as string[] }
  const env: Record<string, string> = { HOME: '/Users/me', ...over.env }
  on('env.get', (_$, e) => ({ value: env[e.name] }))
  on('fs.read', (_$, e) => {
    w.read.push(e.path)
    const text = over.files?.[e.path]
    return text === undefined ? { deny: `no such file: ${e.path}` } : { value: text }
  })
  on('http.fetch', (_$, e) => {
    w.fetched.push({ url: e.url, headers: e.init?.headers ?? {}, body: JSON.parse(e.init?.body ?? '{}') as Record<string, unknown> })
    const api = over.api ?? { status: 500, text: '' }
    return { value: { status: api.status, ok: api.status < 300, headers: {}, text: api.text } }
  })
  on('ui.toast', (_$, e) => {
    w.toasts.push(e.text)
    return { value: undefined }
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('session.repo', () => ({ value: null }))
  on('session.cwd', () => ({ value: '/Users/me/waraxe-claude-mods' }))
  on('model.complete', (_$, e) => {
    w.prompts.push(e.prompt)
    const value: ModelCompleteResult =
      over.haiku === null
        ? { isAnswered: false, reason: 'api-error', status: 529, error: 'overloaded', usage: USAGE }
        : { isAnswered: true, text: over.haiku ?? DONE, usage: USAGE }
    return { value }
  })
  on('audio.play', (_$, e) => {
    w.heard.push(e.clip.asset !== undefined ? `play ${e.clip.asset}` : `play ${e.clip.mime} ${e.clip.base64}`)
    return { value: undefined }
  })
  on('audio.speak', (_$, e) => {
    if (e.voice !== undefined && e.voice === over.missingVoice) return { deny: `voice ${e.voice} is not installed` }
    w.heard.push(`${e.voice ?? 'default'}: ${e.text}`)
    return { value: { via: 'system' as const } }
  })
  on('tool.call', () => ({ result: {}, text: 'ok' }) as never)
  for (const event of ['classic.SessionStart', 'classic.UserPromptSubmit', 'classic.PermissionRequest', 'classic.Notification'] as const) on(event, () => ({}))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  return w
}

async function turn($: Engine, id: string, answer = 'I built the mod. All tests pass.', more: { agentId?: string; isAborted?: boolean; reason?: 'answer' | 'error' } = {}) {
  await $.turn.start({ turnId: id, text: 'go', ...(more.agentId ? { agentId: more.agentId } : {}) })
  await $.turn.complete({
    turnId: id,
    answer,
    durationMs: 2000,
    isAborted: more.isAborted ?? false,
    reason: more.isAborted ? 'aborted' : (more.reason ?? 'answer'),
    ...(more.agentId ? { agentId: more.agentId } : {}),
  } as never)
}

const titled = ($: Engine) => $.classic.UserPromptSubmit({ prompt: 'go', session_title: 'Spoken alerts mod' } as never)

const dialog = (options: Array<{ label: string; description: string }>) => ({
  tool: 'AskUserQuestion' as const,
  questions: [{ question: 'Which voices should the alerts use?', header: 'Voice', multiSelect: false, options }],
})

async function settled(clock: MockClock) {
  await clock.settle()
  await clock.settle()
}

describe('work ending', () => {
  test('a soft chime, then the project, the thread and what was done', async ($, on) => {
    const clock = mock.clock(on, { now: START })
    const w = world(on)
    await titled($)
    await turn($, 't1')
    await settled(clock)

    expect(w.heard).toEqual(['play sounds/done.wav', 'Samantha: Done in waraxe claude mods, thread Spoken alerts mod. Built the spoken alerts mod and its tests.'])
    // Haiku read the reply it summarizes.
    expect(w.prompts[0]).toContain('I built the mod. All tests pass.')
  })

  test('with no title from the engine, Haiku’s topic names the thread', async ($, on) => {
    const clock = mock.clock(on, { now: START })
    const w = world(on)
    await turn($, 't1')
    await settled(clock)
    expect(w.heard[1]).toBe('Samantha: Done in waraxe claude mods, thread spoken alerts. Built the spoken alerts mod and its tests.')
  })

  test('with Haiku down, the reply’s first sentence says what was done', async ($, on) => {
    const clock = mock.clock(on, { now: START })
    const w = world(on, { haiku: null })
    await titled($)
    await turn($, 't1', '**Fixed** the `band` rows. Then I ran the tests.')
    await settled(clock)
    expect(w.heard[1]).toBe('Samantha: Done in waraxe claude mods, thread Spoken alerts mod. Fixed the band rows.')
  })

  test('a turn that ends in an error says so', async ($, on) => {
    const clock = mock.clock(on, { now: START })
    const w = world(on)
    await titled($)
    await turn($, 't1', '', { reason: 'error' })
    await settled(clock)
    expect(w.heard).toEqual(['play sounds/done.wav', 'Samantha: waraxe claude mods, thread Spoken alerts mod stopped with an error.'])
  })

  test('a subagent’s turn and an interrupted turn stay silent', async ($, on) => {
    const clock = mock.clock(on, { now: START })
    const w = world(on)
    await turn($, 'a', 'Report.', { agentId: 'agent-1' })
    await turn($, 't2', '', { isAborted: true })
    await settled(clock)
    expect(w.heard).toEqual([])
  })
})

describe('question alerts', () => {
  test('a question dialog: the bright chime, another voice, the question, then the recommended option', async ($, on) => {
    const clock = mock.clock(on, { now: START })
    const w = world(on)
    await titled($)
    await $.tool.call(dialog([{ label: 'Mac voices (Recommended)', description: 'Free' }, { label: 'OpenAI voices', description: 'Paid' }]))
    await settled(clock)

    expect(w.heard).toEqual([
      'play sounds/question.wav',
      'Daniel: Question from waraxe claude mods, thread Spoken alerts mod.',
      'Daniel: Which voices should the alerts use? Recommended: Mac voices.',
    ])
  })

  test('a dialog with no recommended option lists the options', async ($, on) => {
    const clock = mock.clock(on, { now: START })
    const w = world(on)
    await $.tool.call(dialog([{ label: 'Mac', description: '' }, { label: 'OpenAI', description: '' }, { label: 'None', description: '' }]))
    await settled(clock)
    expect(w.heard[2]).toBe('Daniel: Which voices should the alerts use? Options: Mac, OpenAI, or None.')
  })

  test('the next-step box: after the work alert, its question and its first button', async ($, on) => {
    const clock = mock.clock(on, { now: START })
    const w = world(on)
    await titled($)
    await $.turn.start({ turnId: 't1', text: 'go' })
    await $.tool.call({ tool: 'mcp__ccd_turn__wrap_up', recap: 'Pushed nothing yet.', ask: 'Push main to origin?', actions: [{ label: 'Push main' }, { label: 'Not now' }] } as never)
    await $.turn.complete({ turnId: 't1', answer: 'Committed.', durationMs: 2000, isAborted: false, reason: 'answer' })
    await settled(clock)

    expect(w.heard).toEqual([
      'play sounds/done.wav',
      'Samantha: Done in waraxe claude mods, thread Spoken alerts mod. Built the spoken alerts mod and its tests.',
      'play sounds/question.wav',
      'Daniel: waraxe claude mods, thread Spoken alerts mod asks: Push main to origin?',
      'Daniel: Recommended: Push main.',
    ])
    // The recap went to Haiku with the reply.
    expect(w.prompts[0]).toContain('Pushed nothing yet.')
  })

  test('a next-step button that runs an app action is named as the app labels it', async ($, on) => {
    const clock = mock.clock(on, { now: START })
    const w = world(on)
    await $.turn.start({ turnId: 't1', text: 'go' })
    await $.tool.call({ tool: 'mcp__ccd_turn__wrap_up', recap: 'Ready.', ask: 'Commit these changes?', actions: [{ action: 'commit' }] } as never)
    await $.turn.complete({ turnId: 't1', answer: 'Ready.', durationMs: 2000, isAborted: false, reason: 'answer' })
    await settled(clock)
    expect(w.heard.at(-1)).toBe('Daniel: Recommended: Commit.')
  })

  test('a next-step box with no question adds no question alert', async ($, on) => {
    const clock = mock.clock(on, { now: START })
    const w = world(on)
    await $.turn.start({ turnId: 't1', text: 'go' })
    await $.tool.call({ tool: 'mcp__ccd_turn__wrap_up', recap: 'Done.' } as never)
    await $.turn.complete({ turnId: 't1', answer: 'Done.', durationMs: 2000, isAborted: false, reason: 'answer' })
    await settled(clock)
    expect(w.heard.filter(h => h.includes('question'))).toEqual([])
  })

  test('a permission prompt says what Claude asks to do, and its notification is not spoken again', async ($, on) => {
    const clock = mock.clock(on, { now: START })
    const w = world(on)
    await titled($)
    await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'npm test', description: 'Run the tests' } } as never)
    await $.classic.Notification({ message: 'Claude needs your permission to use Bash', notification_type: 'permission_prompt' } as never)
    await settled(clock)

    expect(w.heard).toEqual([
      'play sounds/question.wav',
      'Daniel: waraxe claude mods, thread Spoken alerts mod needs your permission.',
      'Daniel: Claude asks to run a command: Run the tests.',
    ])
  })

  test('a permission notification heard alone is spoken; an idle reminder is not', async ($, on) => {
    const clock = mock.clock(on, { now: START })
    const w = world(on)
    await $.classic.Notification({ message: 'Claude is waiting for your input', notification_type: 'idle_prompt' } as never)
    await $.classic.Notification({ message: 'Claude needs your permission to use Edit', notification_type: 'permission_prompt' } as never)
    await settled(clock)
    expect(w.heard).toEqual(['play sounds/question.wav', 'Daniel: waraxe claude mods needs your permission.', 'Daniel: Claude needs your permission to use Edit'])
  })

  test('a task assigned to you is spoken with its options', async ($, on) => {
    const clock = mock.clock(on, { now: START })
    const w = world(on)
    await $.tool.call({ tool: 'mcp__human-in-the-loop__assign_task', title: 'Pick a voice', why: 'Only you can.', kind: 'choose', options: ['Samantha', 'Daniel'] } as never)
    await settled(clock)
    expect(w.heard).toEqual(['play sounds/question.wav', 'Daniel: waraxe claude mods assigned you a task.', 'Daniel: Pick a voice. Options: Samantha, or Daniel.'])
  })
})

describe('both alerts', () => {
  test('sound different: another chime and another voice', async ($, on) => {
    const clock = mock.clock(on, { now: START })
    const w = world(on)
    await turn($, 't1')
    await $.tool.call(dialog([{ label: 'Yes (Recommended)', description: '' }, { label: 'No', description: '' }]))
    await settled(clock)
    const plays = w.heard.filter(h => h.startsWith('play '))
    const voices = new Set(w.heard.filter(h => !h.startsWith('play ')).map(h => h.split(':')[0]))
    expect(plays).toEqual(['play sounds/done.wav', 'play sounds/question.wav'])
    expect([...voices].sort()).toEqual(['Daniel', 'Samantha'])
  })

  test('a voice this Mac lacks falls back to the default voice', async ($, on) => {
    const clock = mock.clock(on, { now: START })
    const w = world(on, { missingVoice: 'Daniel' })
    await $.tool.call(dialog([{ label: 'Yes (Recommended)', description: '' }, { label: 'No', description: '' }]))
    await settled(clock)
    expect(w.heard).toEqual(['play sounds/question.wav', 'default: Question from waraxe claude mods.', 'default: Which voices should the alerts use? Recommended: Yes.'])
  })
})

// Two base64 pieces of one clip, as OpenAI streams them, and the clip whole.
const PIECES = ['AQID', 'BAUGBw==']
const WHOLE = 'AQIDBAUGBw=='
const SSE = PIECES.map(audio => `data: {"type":"speech.audio.delta","audio":"${audio}"}\n\n`).join('') + 'data: {"type":"speech.audio.done"}\n\n'
const OPENAI = { provider: 'openai', openaiApiKey: 'test-key' }
const ELEVENLABS = { provider: 'elevenlabs', elevenlabsApiKey: 'test-key' }

describe('cloud voices', () => {
  test('OpenAI: each alert in its own voice and style, its streamed pieces played as one clip', { options: OPENAI }, async ($, on) => {
    const clock = mock.clock(on, { now: START })
    const w = world(on, { api: { status: 200, text: SSE } })
    await titled($)
    await turn($, 't1')
    await $.tool.call(dialog([{ label: 'Yes (Recommended)', description: '' }, { label: 'No', description: '' }]))
    await settled(clock)

    expect(w.heard).toEqual(['play sounds/done.wav', `play audio/mpeg ${WHOLE}`, 'play sounds/question.wav', `play audio/mpeg ${WHOLE}`])
    expect(w.fetched.map(f => f.url)).toEqual(['https://api.openai.com/v1/audio/speech', 'https://api.openai.com/v1/audio/speech'])
    expect(w.fetched[0]!.headers.authorization).toBe('Bearer test-key')
    expect(w.fetched.map(f => f.body.voice)).toEqual(['onyx', 'nova'])
    expect(w.fetched[0]!.body.input).toBe('Done in waraxe claude mods, thread Spoken alerts mod. Built the spoken alerts mod and its tests.')
    expect(w.fetched[1]!.body.input).toBe('Question from waraxe claude mods, thread Spoken alerts mod. Which voices should the alerts use? Recommended: Yes.')
    expect(w.fetched[0]!.body.instructions).not.toBe(w.fetched[1]!.body.instructions)
    expect(w.toasts).toEqual([])
  })

  // Every provider's pair set at once: only the chosen provider's is used.
  const ALL_VOICES = {
    macDoneVoice: 'Fred',
    macQuestionVoice: 'Kathy',
    openaiDoneVoice: 'ash',
    openaiQuestionVoice: 'shimmer',
    elevenlabsDoneVoice: 'el-done',
    elevenlabsQuestionVoice: 'el-question',
  }
  const both = async ($: Engine, clock: MockClock) => {
    await turn($, 't1')
    await $.tool.call(dialog([{ label: 'Yes (Recommended)', description: '' }, { label: 'No', description: '' }]))
    await settled(clock)
  }

  test('the OpenAI voice settings replace the defaults', { options: { ...OPENAI, ...ALL_VOICES } }, async ($, on) => {
    const clock = mock.clock(on, { now: START })
    const w = world(on, { api: { status: 200, text: SSE } })
    await both($, clock)
    expect(w.fetched.map(f => f.body.voice)).toEqual(['ash', 'shimmer'])
  })

  test('switched to ElevenLabs, its own voice settings are used, not OpenAI’s', { options: { ...ELEVENLABS, ...ALL_VOICES } }, async ($, on) => {
    const clock = mock.clock(on, { now: START })
    const w = world(on, { api: { status: 200, text: JSON.stringify({ audio_base64: WHOLE }) } })
    await both($, clock)
    expect(w.fetched.map(f => f.url.split('/')[5])).toEqual(['el-done', 'el-question'])
  })

  test('the Mac voice settings speak when a cloud voice fails', { options: { ...OPENAI, ...ALL_VOICES } }, async ($, on) => {
    const clock = mock.clock(on, { now: START })
    const w = world(on, { api: { status: 401, text: '' } })
    await both($, clock)
    expect(w.heard.filter(h => !h.startsWith('play ')).map(h => h.split(':')[0])).toEqual(['Fred', 'Kathy', 'Kathy'])
  })

  test('the Mac voice settings replace Samantha and Daniel', { options: ALL_VOICES }, async ($, on) => {
    const clock = mock.clock(on, { now: START })
    const w = world(on)
    await both($, clock)
    expect(w.fetched).toEqual([])
    expect(w.heard.filter(h => !h.startsWith('play ')).map(h => h.split(':')[0])).toEqual(['Fred', 'Kathy', 'Kathy'])
  })

  test('ElevenLabs: the voice ID in the address, the key in its header, the base64 audio played', { options: ELEVENLABS }, async ($, on) => {
    const clock = mock.clock(on, { now: START })
    const w = world(on, { api: { status: 200, text: JSON.stringify({ audio_base64: WHOLE, alignment: {} }) } })
    await $.tool.call(dialog([{ label: 'Yes (Recommended)', description: '' }, { label: 'No', description: '' }]))
    await settled(clock)

    expect(w.heard).toEqual(['play sounds/question.wav', `play audio/mpeg ${WHOLE}`])
    expect(w.fetched[0]!.url).toBe('https://api.elevenlabs.io/v1/text-to-speech/JBFqnCBsd6RMkjVDRZzb/with-timestamps?output_format=mp3_44100_128')
    expect(w.fetched[0]!.headers['xi-api-key']).toBe('test-key')
    expect(w.fetched[0]!.body.model_id).toBe('eleven_flash_v2_5')
  })

  test('a refused key: the Mac voices speak, and one toast says why', { options: OPENAI }, async ($, on) => {
    const clock = mock.clock(on, { now: START })
    const w = world(on, { api: { status: 401, text: '{"error":{"message":"Incorrect API key provided: test-***"}}' } })
    await turn($, 't1')
    await $.tool.call(dialog([{ label: 'Yes (Recommended)', description: '' }, { label: 'No', description: '' }]))
    await settled(clock)

    expect(w.heard).toEqual([
      'play sounds/done.wav',
      'Samantha: Done in waraxe claude mods, thread spoken alerts. Built the spoken alerts mod and its tests.',
      'play sounds/question.wav',
      'Daniel: Question from waraxe claude mods, thread spoken alerts.',
      'Daniel: Which voices should the alerts use? Recommended: Yes.',
    ])
    // Never the reply's text: it can echo part of the key.
    expect(w.toasts).toEqual(['spoken-alerts: the OpenAI voice failed (the API key was refused), so the Mac voice spoke.'])
  })

  test('no key anywhere: no request goes out, and the Mac voice speaks', { options: { provider: 'elevenlabs' } }, async ($, on) => {
    const clock = mock.clock(on, { now: START })
    const w = world(on)
    await $.tool.call(dialog([{ label: 'Yes (Recommended)', description: '' }, { label: 'No', description: '' }]))
    await settled(clock)
    expect(w.fetched).toEqual([])
    expect(w.read).toEqual(['/Users/me/.claude/.env'])
    expect(w.heard[1]).toBe('Daniel: Question from waraxe claude mods.')
    expect(w.toasts).toEqual([
      'spoken-alerts: the ElevenLabs voice failed (no ElevenLabs API key in the settings, ELEVENLABS_API_KEY or ~/.claude/.env), so the Mac voice spoke.',
    ])
  })

  test('with the key setting empty, the key comes from ~/.claude/.env', { options: { provider: 'openai' } }, async ($, on) => {
    const clock = mock.clock(on, { now: START })
    const env = '# keys\nexport OPENAI_API_KEY="file-key"  # mine\nELEVENLABS_API_KEY=other\n'
    const w = world(on, { api: { status: 200, text: SSE }, files: { '/Users/me/.claude/.env': env } })
    await $.tool.call(dialog([{ label: 'Yes (Recommended)', description: '' }, { label: 'No', description: '' }]))
    await settled(clock)
    expect(w.fetched[0]!.headers.authorization).toBe('Bearer file-key')
    expect(w.heard).toEqual(['play sounds/question.wav', `play audio/mpeg ${WHOLE}`])
  })

  test('ElevenLabs takes the environment’s key before the file’s', { options: { provider: 'elevenlabs' } }, async ($, on) => {
    const clock = mock.clock(on, { now: START })
    const w = world(on, {
      api: { status: 200, text: JSON.stringify({ audio_base64: WHOLE }) },
      env: { ELEVENLABS_API_KEY: 'env-key' },
      files: { '/Users/me/.claude/.env': 'ELEVENLABS_API_KEY=file-key\n' },
    })
    await $.tool.call(dialog([{ label: 'Yes (Recommended)', description: '' }, { label: 'No', description: '' }]))
    await settled(clock)
    expect(w.fetched[0]!.headers['xi-api-key']).toBe('env-key')
    expect(w.read).toEqual([])
  })

  test('a key in the settings comes before the environment and the file', { options: ELEVENLABS }, async ($, on) => {
    const clock = mock.clock(on, { now: START })
    const w = world(on, {
      api: { status: 200, text: JSON.stringify({ audio_base64: WHOLE }) },
      env: { ELEVENLABS_API_KEY: 'env-key' },
      files: { '/Users/me/.claude/.env': 'ELEVENLABS_API_KEY=file-key\n' },
    })
    await $.tool.call(dialog([{ label: 'Yes (Recommended)', description: '' }, { label: 'No', description: '' }]))
    await settled(clock)
    expect(w.fetched[0]!.headers['xi-api-key']).toBe('test-key')
  })
})

describe('/spoken-alerts-test', () => {
  test('answers at once, plays both alerts, then a toast says which voices spoke', { options: OPENAI }, async ($, on) => {
    const clock = mock.clock(on, { now: START })
    const w = world(on, { api: { status: 200, text: SSE } })
    await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/Users/me/waraxe-claude-mods' })
    const r = await $.command.run({ command: 'spoken-alerts-test', args: '' } as never)
    expect(r.text).toBe('Playing both alerts with the OpenAI voices onyx and nova. A toast says when they have played, or why the Mac voices spoke instead.')
    await settled(clock)
    expect(w.heard).toEqual(['play sounds/done.wav', `play audio/mpeg ${WHOLE}`, 'play sounds/question.wav', `play audio/mpeg ${WHOLE}`])
    expect(w.toasts).toEqual(['spoken-alerts: both alerts played with the OpenAI voices onyx and nova.'])
  })

  test('a toast says why the cloud voice failed, even when an alert already said so', { options: OPENAI }, async ($, on) => {
    const clock = mock.clock(on, { now: START })
    const w = world(on, { api: { status: 429, text: '' } })
    await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/Users/me/waraxe-claude-mods' })
    await $.tool.call(dialog([{ label: 'Yes (Recommended)', description: '' }, { label: 'No', description: '' }]))
    await settled(clock)
    await $.command.run({ command: 'spoken-alerts-test', args: '' } as never)
    await settled(clock)
    const why = 'spoken-alerts: the OpenAI voice failed (out of credits or rate-limited (429)), so the Mac voice spoke.'
    expect(w.toasts).toEqual([why, why])
  })

  test('with the Mac voices it says so at once', async ($, on) => {
    const clock = mock.clock(on, { now: START })
    const w = world(on)
    await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/Users/me/waraxe-claude-mods' })
    const r = await $.command.run({ command: 'spoken-alerts-test', args: '' } as never)
    expect(r.text).toBe('Playing both alerts with the Mac voices Samantha and Daniel.')
    await settled(clock)
    expect(w.heard[1]).toBe('Samantha: Done in waraxe claude mods. This is the work-done alert.')
    expect(w.toasts).toEqual([])
  })
})

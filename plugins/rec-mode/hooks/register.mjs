// REC mode: /rec before you record or share your screen. Built on Nate Herk's recording-mode.
// While it is on, in every Claude Code session on this machine:
// - keys, .env values, emails, names, phone numbers, addresses, ID and account numbers,
//   money, and business figures are masked wherever the transcript draws text
// - results from mail, chat, tasks, files, calendar, and finance tools draw as hidden
// - Claude can't open private files (.env files, credentials, Claude's memory, finance
//   documents, and anything you list in the config file) or finance tools, and each
//   prompt tells it to keep plans and figures out of its replies
// - every other mod's sound stays off: spoken-alerts, narrator, any chime
// - a pulsing red ● REC above the prompt shows it's on; a grey ○ REC shows it's off,
//   and pressing either switches it
// /rec strict also masks every large figure and percentage. /rec off turns it all off.
// bin/rec switches it from outside Claude Code (a macOS Shortcuts hotkey).
// /rec config makes ~/.claude/mods-data/rec-mode/config.json for your own name,
// the people to hide, your private folders, and extra tools.
// It changes what is drawn, what Claude may open, and what other mods may play; the note to
// Claude is the one thing it adds.

import { makeMasker, deepMask, hideText, privatePathHit, toolCallTargets, secretValuesFromEnv, businessSource, financeTool } from './privacy.mjs'

// bin/rec writes the same file
const FLAG_PATH = '/.claude/mods-data/rec-mode/state.json'
const CONFIG_PATH = '/.claude/mods-data/rec-mode/config.json'

// macOS commands a mod may run to make a sound without $.audio
const SOUND_COMMANDS = ['say', 'afplay']

const CONFIG_TEMPLATE = {
  keepNames: ['Your Name'],
  names: ['A Teammate', 'A Client'],
  privatePaths: ['clients/', 'finance/', 'my-private-notes.md'],
  businessTools: [],
  closedTools: [],
}

const CONFIG_HELP = [
  'keepNames: your own name (and your brand), shown even while recording.',
  'names: people whose names are always masked (teammates, clients). Names in emails and contact fields are learned on their own.',
  'privatePaths: folders or file names Claude may not open while recording. Any part of a path, any case.',
  'businessTools: tool or command names (any part) whose results draw as hidden, beyond the built-in list.',
  'closedTools: tool names (any part) Claude may not call while recording, beyond the built-in finance tools.',
]

// Drawn as a plain image: an interactive Svg sits in an iframe that paints an
// opaque white box in the dark theme and reloads on every band redraw.
// SMIL still runs in an image. One fading dot, no ring, so a restart barely shows.
const REC_RED = '#e5484d'
const REC_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="54" height="18" viewBox="0 0 54 18">' +
  `<circle cx="8" cy="9" r="5" fill="${REC_RED}"><animate attributeName="opacity" values="1;0.35;1" dur="1.6s" repeatCount="indefinite" calcMode="spline" keyTimes="0;0.5;1" keySplines="0.45 0 0.55 1;0.45 0 0.55 1"/></circle>` +
  `<text x="19" y="13.2" font-family="-apple-system,'Segoe UI',system-ui,sans-serif" font-size="12" font-weight="700" letter-spacing="0.8" fill="${REC_RED}">REC</text>` +
  '</svg>'

let home = ''
let cwd = ''
let commandName = 'rec'
let rec = { on: false, strict: false, since: 0 }
let values = [] // .env secret values: kept in memory only, never written anywhere
let config = { keepNames: [], names: [], privatePaths: [], businessTools: [], closedTools: [] }
let mask = (s) => s
let blocked = 0
let silenced = 0 // sounds other mods tried to play since REC came on
let noteSent = false
const businessCalls = new Set() // tool_use_ids whose results are business data

function strings(v) {
  return Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()).slice(0, 500) : []
}

function noteOn() {
  const keep = config.keepNames.length ? ` (other than ${config.keepNames.join(', ')})` : ''
  return (
    `Recording mode is on: this screen is being recorded for a public video. In replies and in tool commands, leave out people's names${keep}, emails, phone numbers, addresses, account numbers, dollar amounts, revenue, profit, pricing, compensation, and other business figures, and internal plans, strategy, deals, hiring, and team matters. ` +
    'Write placeholders like [name], [amount], or [internal plan] instead and keep summaries high level. Private files and finance tools stay closed until recording stops.'
  )
}
const NOTE_OFF = 'Recording mode is off now. The earlier recording-mode note no longer applies.'

function apply() {
  mask = rec.on ? makeMasker({ strict: rec.strict, values, names: config.names, keepNames: config.keepNames }) : (s) => s
}

async function load($) {
  await loadEnvValues($)
  await loadConfig($)
}

function unload() {
  values = []
  businessCalls.clear()
}

async function loadConfig($) {
  try {
    const path = home + CONFIG_PATH
    if (!(await $.fs.exists(path))) return
    const raw = JSON.parse(await $.fs.read(path))
    config = {
      keepNames: strings(raw.keepNames),
      names: strings(raw.names),
      privatePaths: strings(raw.privatePaths),
      businessTools: strings(raw.businessTools),
      closedTools: strings(raw.closedTools),
    }
  } catch {
    // a broken config file: the built-in rules still apply
  }
}

function parentDirs(path, levels) {
  const parts = String(path || '').replace(/\\/g, '/').split('/')
  const out = []
  for (let i = parts.length; i > 0 && out.length <= levels; i--) out.push(parts.slice(0, i).join('/'))
  return out.filter(Boolean)
}

async function loadEnvValues($) {
  const found = []
  for (const dir of parentDirs(cwd, 3)) {
    for (const name of ['.env', '.env.local']) {
      const p = dir + '/' + name
      try {
        if (await $.fs.exists(p)) found.push(...secretValuesFromEnv(await $.fs.read(p)))
      } catch {
        // unreadable: patterns still catch the common key formats
      }
    }
  }
  values = [...new Set(found)].sort((a, b) => b.length - a.length)
}

// null when the file can't be read (half written, say): REC then stays as it was
async function readFlag($) {
  try {
    const path = home + FLAG_PATH
    if (!(await $.fs.exists(path))) return { on: false, strict: false, since: 0 }
    const flag = JSON.parse(await $.fs.read(path))
    return { on: !!flag.on, strict: !!flag.strict, since: flag.since || 0 }
  } catch {
    return null
  }
}

// Another session or bin/rec may have turned recording on or off
async function syncFlag($) {
  const flag = await readFlag($)
  if (!flag || (flag.on === rec.on && flag.strict === rec.strict)) return
  const starting = flag.on && !rec.on
  rec = flag
  if (rec.on) await load($)
  else unload()
  if (starting) blocked = silenced = 0
  apply()
  $.ui.invalidate('ui.render')
}

async function setFlag($, on, strict) {
  const starting = on && !rec.on
  rec = { on, strict: on && strict, since: on ? await $.clock.now() : 0 }
  await $.fs.write(home + FLAG_PATH, JSON.stringify(rec))
  if (rec.on) await load($)
  else unload()
  if (starting) blocked = silenced = 0
  apply()
  $.ui.invalidate('ui.render')
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

// /rec and the badge: '' switches, 'off', 'strict', anything else turns it on
async function switchRec($, arg) {
  if (arg === 'off' || (arg === '' && rec.on)) {
    await setFlag($, false, false)
    const kept = [blocked && `kept ${plural(blocked, 'private file')} closed`, silenced && `silenced ${plural(silenced, 'sound')}`].filter(Boolean)
    $.ui.toast('REC off. Mod sounds are back on.' + (kept.length ? ` It ${kept.join(' and ')}.` : ''))
    return
  }
  const strict = arg === 'strict'
  await setFlag($, true, strict)
  $.ui.toast(`REC on${strict ? ' (strict)' : ''}: screen masked, mod sounds off.`, { timeoutMs: 3000 })
}

// /rec config: make the file the first time, then say where it is and what goes in it
async function configText($) {
  const path = home + CONFIG_PATH
  let made = false
  try {
    if (!(await $.fs.exists(path))) {
      await $.fs.write(path, JSON.stringify(CONFIG_TEMPLATE, null, 2) + '\n')
      made = true
    }
  } catch {
    return `Could not write ${path}. Make it by hand with this shape:\n${JSON.stringify(CONFIG_TEMPLATE, null, 2)}`
  }
  await loadConfig($)
  apply()
  return [
    `${made ? 'Made' : 'Your'} recording config: ${path}`,
    made ? 'It holds example values. Replace them with your own, save, and run /rec again.' : `Loaded: ${config.keepNames.length} kept name(s), ${config.names.length} hidden name(s), ${config.privatePaths.length} private path(s).`,
    ...CONFIG_HELP,
  ].join('\n')
}

async function registerCommand($) {
  const spec = { name: 'rec', description: 'REC mode: hide keys, personal details, business figures, and private files on screen, and silence mod sounds (/rec strict, /rec off, /rec config)', argumentHint: '[strict|off|config]', immediate: true }
  try {
    await $.command.register(spec)
    return 'rec'
  } catch {
    try {
      await $.command.register({ ...spec, name: 'recording' })
      return 'recording'
    } catch {
      return null
    }
  }
}

export function register(on) {
  on('session.start', async ($, e, next) => {
    home = (await $.env.get('USERPROFILE')) || (await $.env.get('HOME')) || ''
    cwd = await $.session.cwd()
    commandName = (await registerCommand($)) || commandName
    await loadConfig($)
    await syncFlag($)
    $.clock.every(3000, () => syncFlag($).catch(() => {}))
    return next(e)
  })

  on('command.run', { command: ['rec', 'recording'] }, async ($, e) => {
    const arg = String(e.args || '').trim().toLowerCase()
    if (arg === 'config') return { text: await configText($) }
    await switchRec($, arg)
    return {}
  })

  // Every other mod's sound stays off while recording: spoken-alerts, narrator, a chime.
  // The flag is read first, so a switch from bin/rec counts before the next 3-second poll.
  // The call resolves as if it had played, so the mod neither tries another voice nor says it failed.
  on('audio.play', async ($, e, next) => {
    await syncFlag($).catch(() => {})
    if (!rec.on) return next(e)
    silenced += 1
    return { value: undefined }
  })

  on('audio.speak', async ($, e, next) => {
    await syncFlag($).catch(() => {})
    if (!rec.on) return next(e)
    silenced += 1
    return { value: { via: 'system' } }
  })

  // A mod may run say or afplay itself instead (narrator does). Only those two are answered;
  // every other command runs as usual. A clean exit, so the mod doesn't say it failed.
  on('process.run', async ($, e, next) => {
    const command = String((e.argv && e.argv[0]) || '').split('/').pop()
    if (!SOUND_COMMANDS.includes(command)) return next(e)
    await syncFlag($).catch(() => {})
    if (!rec.on) return next(e)
    silenced += 1
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })

  // Claude reads a note beside each prompt while recording, and one more when it stops
  on('prompt.submit', async ($, e, next) => {
    const note = rec.on ? noteOn() : noteSent ? NOTE_OFF : null
    if (!note) return next(e)
    noteSent = rec.on
    return next({ ...e, context: [...(e.context ?? []), note] })
  })

  // Private files and finance tools stay closed while recording
  on('tool.call', async ($, e, next) => {
    if (!rec.on) return next(e)
    const hit = financeTool(e.tool, config.closedTools) ? 'finance tools' : privatePathHit(toolCallTargets(e).join('\n'), config.privatePaths)
    if (!hit) {
      if (businessSource(e.tool, e, config.businessTools)) businessCalls.add(e.tool_use_id)
      return next(e)
    }
    blocked += 1
    return {
      deny: `Recording mode is on, so "${hit}" stays closed while the screen is being recorded. Continue without it, or ask the user to run /${commandName} off first.`,
    }
  })

  // Text rows: prompts, replies, command output
  on('ui.render', { component: ['UserMessage', 'AssistantMessage', 'CommandOutput'] }, async ($, e, next) => {
    if (!rec.on || typeof e.props.text !== 'string') return next(e)
    return next({ ...e, props: { ...e.props, text: mask(e.props.text) } })
  })

  // Tool rows: the call's input is masked; a business tool's result is hidden whole
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (!rec.on) return next(e)
    const business = businessSource(e.props.tool, e.props.input, config.businessTools) || businessCalls.has(e.props.tool_use_id)
    if (business) businessCalls.add(e.props.tool_use_id)
    const props = { ...e.props, input: deepMask(e.props.input, mask) }
    if (e.props.output !== undefined) props.output = deepMask(e.props.output, business ? hideText : mask)
    return next({ ...e, props })
  })

  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if (!rec.on) return next(e)
    const business = businessSource(e.props.tool, null, config.businessTools) || businessCalls.has(e.props.tool_use_id)
    return next({ ...e, props: { ...e.props, output: deepMask(e.props.output, business ? hideText : mask) } })
  })

  // The badge: a pulsing red ● REC while on, a grey ○ REC while off. Pressing it switches REC.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    if (e.props && e.props.hasSurvey) return below
    const el = $.ui.resolve(e)
    const press = () => {
      switchRec($, rec.on ? 'off' : '').catch(() => {})
    }
    const line = rec.on
      ? el.Box({
          flexDirection: 'row',
          alignItems: 'center',
          gap: 1,
          children: [
            e.surface === 'terminal' || !el.Svg
              ? el.Text({ color: 'red', bold: true, children: ['● REC'] })
              : el.Svg({ source: REC_SVG, alt: 'REC', width: 54, height: 18 }),
            el.Text({ dimColor: true, children: [`${rec.strict ? 'strict mask' : 'masked'} · mod sounds off`] }),
            el.Button({ key: 'rec-switch', label: 'Stop', plain: true, dimColor: true, onPress: press }),
          ],
        })
      : el.Button({ key: 'rec-switch', label: '○ REC', plain: true, dimColor: true, onPress: press })
    // Claude Code's own placeholder ({ type: 'engine' }) is never nested: the desktop drops a band that nests it.
    return el.Box({ flexDirection: 'column', children: below && below.type !== 'engine' ? [line, below] : [line] })
  })

  // The footer label shows even when the band is collapsed
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    if (!rec.on) return next(e)
    const modes = Array.isArray(e.props && e.props.modes) ? e.props.modes : []
    return next({ ...e, props: { ...e.props, modes: ['● REC', ...modes] } })
  })
}

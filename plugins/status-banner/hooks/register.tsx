// status-banner: one banner above the prompt with the plan's usage, the session's figures, a
// summary of where the work stands and a heads-up after long turns, plus keep-warm pings for the
// prompt cache. It stands in for session-band, usage-meter, where-am-i and heads-up (README.md).
import { atom, read, update } from 'claude-code'
import type { EngineInterface, PromptOrigin, Register, RenderNode, SessionUsage, Timer, ToolCallInput, ToolCallResult } from 'claude-code'

import type { Cache, PlanWindow, Session, Summary, Warm } from '../types'
import { countdown, liveWindows, mmss, parseFlags, parseSummary, pingUsd, planColor, planLabel, resetTime, textBar, usd } from './format'

// Replies shorter than this are mostly tool-call stubs, and one that came in one burst cannot
// be timed: such speed readings are dropped (session-band's rule).
const MIN_TOKENS = 20
const MIN_SECONDS = 0.5
const MAX_SPEED = 1000

// Minutes left at which a 1-hour cache's expiry is announced, once each per answer.
const NOTIFY_MINUTES = [10, 5] as const
// A plan window's toast fires once it passes this percentage.
const PLAN_WARN_AT = 90

const PING_PROMPT = 'Reply with the single word: warm'
const MAX_FAILURES = 3

// heads-up: the first prompts of a session are never checked, nor a short reply.
const QUIET_PROMPTS = 3
const MIN_REPLY = 300
const MAX_STEPS = 60

const SPEED = '#8b8cf8'
const MONEY = '#4caf6e'
const MUTED = '#8a8f8c'
const CONTEXT = '#5fa8d3'
const CACHE = '#4fb3a9'
const WARN = '#e2a94e'
const ALERT = '#e0846b'

// The desktop draws session-band's look: 22px icons beside body text, which runs about 0.9 of
// bodyColumns' code-font cells per character (measured on session-band's row); a cell is about
// 8 CSS pixels (helper-desk's measure).
const ICON_PX = 22
const TEXT_CELLS = 0.9
const CELL_PX = 8
// A plan part's stretched bar is drawn only when it gets at least this many cells.
const MIN_BAR = 6

const FRESH: Session = { turn: 0, speed: null, turnCost: null, total: null, context: null, costAtStart: 0 }

const session = atom({ plugin: 'status-banner', key: 'session' } as const, FRESH)
const plan = atom({ plugin: 'status-banner', key: 'plan' } as const, [] as PlanWindow[])
const cache = atom({ plugin: 'status-banner', key: 'cache' } as const, { lastRequestAt: null, secondsLeft: null } as Cache)
const warm = atom({ plugin: 'status-banner', key: 'warm' } as const, { until: 0, nextPingAt: null, failures: 0, lastPing: null } as Warm)
const summary = atom({ plugin: 'status-banner', key: 'summary' } as const, null as Summary | null)
const flags = atom({ plugin: 'status-banner', key: 'flags' } as const, [] as string[])
const prompts = atom({ plugin: 'status-banner', key: 'prompts' } as const, 0)
// A main-thread turn is running: no ping and no cache warning meanwhile.
const isBusy = atom({ plugin: 'status-banner', key: 'isBusy' } as const, false)
// The current minute: redraws the reset and keep-warm times.
const tick = atom({ plugin: 'status-banner', key: 'tick' } as const, 0)
// The smallest NOTIFY_MINUTES already announced since the last answer; 0 none.
const warned = atom({ plugin: 'status-banner', key: 'warned' } as const, 0)
// Per plan window, the reset time its toast fired for.
const planWarned = atom({ plugin: 'status-banner', key: 'planWarned' } as const, {} as Record<string, number>)

// Icons for the desktop; the terminal draws text. The icons are session-band's (JohnnyVizz, MIT).
const ring = (color: string, glyph: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
    <circle cx="12" cy="12" r="10" fill="none" stroke="${color}" stroke-width="2"/>
    ${glyph}</svg>`

const SPEED_ICON = ring(
  SPEED,
  `<path d="M6.5 15a6 6 0 0 1 11 0" fill="none" stroke="${SPEED}" stroke-width="1.8" stroke-linecap="round"/>
   <path d="M12 15l3-4" stroke="${SPEED}" stroke-width="1.8" stroke-linecap="round"/>`,
)

const MONEY_ICON = ring(
  MONEY,
  `<text x="12" y="16.5" text-anchor="middle" font-family="-apple-system,sans-serif" font-size="13" font-weight="600" fill="${MONEY}">$</text>`,
)

// The ring fills with the context, around a page of lines.
const contextIcon = (percent: number) => {
  const c = 2 * Math.PI * 10
  const filled = (Math.min(100, percent) / 100) * c
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
    <circle cx="12" cy="12" r="10" fill="none" stroke="${MUTED}" stroke-opacity="0.35" stroke-width="2"/>
    <circle cx="12" cy="12" r="10" fill="none" stroke="${CONTEXT}" stroke-width="2" stroke-linecap="round"
      stroke-dasharray="${filled.toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 12 12)"/>
    <g stroke="${CONTEXT}" stroke-width="1.6" stroke-linecap="round">
      <path d="M8.5 9h7M8.5 12h7M8.5 15h4.5"/>
    </g></svg>`
}

// An hourglass: the prompt cache running out.
const cacheIcon = (color: string) =>
  ring(
    color,
    `<g fill="none" stroke="${color}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round">
       <path d="M8.5 6.5h7M8.5 17.5h7"/>
       <path d="M9.5 6.5c0 3 5 3.5 5 5.5s-5 2.5-5 5.5M14.5 6.5c0 3-5 3.5-5 5.5s5 2.5 5 5.5"/>
     </g>`,
  )

const svgBar = (percent: number, color: string, width: number) => {
  const w = Math.round((Math.min(100, Math.max(0, percent)) / 100) * width)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 6" width="${width}" height="6">
    <rect width="${width}" height="6" rx="3" fill="${MUTED}" fill-opacity="0.3"/>
    <rect width="${w}" height="6" rx="3" fill="${color}"/></svg>`
}

// The context bar's color: green, amber from 65%, red from 85% (session-band's).
const contextColor = (percent: number) => (percent >= 85 ? ALERT : percent >= 65 ? WARN : MONEY)

// From widest to narrowest: the highest field priority kept, whether the context bar is drawn,
// how Keep warm is labelled (`short` and `icon` shrink its label while on; `icon` also while off)
// and the gap between fields. Each row takes the first stage it fits; both keep the lower maxP.
type Stage = { maxP: number; bars: boolean; warm: 'full' | 'short' | 'icon'; gap: number }
const STAGES: Stage[] = [
  { maxP: 4, bars: true, warm: 'full', gap: 3 },
  { maxP: 4, bars: false, warm: 'full', gap: 2 },
  { maxP: 4, bars: false, warm: 'short', gap: 1 },
  { maxP: 3, bars: false, warm: 'short', gap: 1 },
  { maxP: 2, bars: false, warm: 'icon', gap: 1 },
  { maxP: 1, bars: false, warm: 'icon', gap: 1 },
]

// One field of a row: its narrow-window priority (1 stays longest), its width in cells, its
// drawing, and whether it sits at the row's right end.
type Field = { p: number; width: number; node: RenderNode; isEnd?: boolean }

// One tool call of the turn, as the heads-up check reads it.
type Step = { tool: string; what: string; isFailed: boolean; output: string }

// Read from the options each time the module registers.
const cfg = { ttl: 60 * 60_000, lead: 10 * 60_000, retry: 150_000, windowMs: 2 * 3_600_000, hasSummary: true, hasHeadsUp: true }

// The module's own working state; a reload starts it over.
const mem = {
  ticker: undefined as Timer | undefined, // one ticker, even if session.start fires again
  inFlight: false,
  lastModel: null as string | null,
  // The main turn whose summary or heads-up may still land: a newer turn makes an older answer stale.
  latest: '',
  asked: '',
  steps: [] as Step[],
}

// The main thread just used the cache: its countdown starts again, and so does keep-warm's.
async function touch($: EngineInterface, at: number) {
  await update($, cache, () => ({ lastRequestAt: at, secondsLeft: Math.floor(cfg.ttl / 1000) }))
  await update($, warm, w => (w.until === 0 ? w : { ...w, nextPingAt: at + cfg.ttl - cfg.lead, failures: 0 }))
}

async function stopWarm($: EngineInterface, why: string | null) {
  if ((await read($, warm)).until === 0) return
  await update($, warm, w => ({ ...w, until: 0, nextPingAt: null, failures: 0 }))
  if (why) $.ui.toast(`Keep warm stopped: ${why}`)
}

async function toggleWarm($: EngineInterface) {
  if ((await read($, warm)).until !== 0) return stopWarm($, null)
  const now = await $.clock.now()
  const { lastRequestAt } = await read($, cache)
  await update($, warm, () => ({
    until: now + cfg.windowMs,
    nextPingAt: lastRequestAt === null ? null : lastRequestAt + cfg.ttl - cfg.lead,
    failures: 0,
    lastPing: null,
  }))
}

// One background request over the main thread's last request (cache-tax's approach, MIT):
// the API reads the chat from the cache, and the cache's clock starts again.
async function ping($: EngineInterface) {
  mem.inFlight = true
  const sent = await $.model.fork({ prompt: PING_PROMPT }).catch(() => null)
  mem.inFlight = false
  const at = await $.clock.now()
  // Turned off, cleared or compacted while the ping was out.
  if ((await read($, warm)).until === 0) return

  if (sent?.isAnswered) {
    const u = sent.usage
    const model = mem.lastModel ?? (await $.session.model().catch(() => ''))
    const lastPing = { at, usd: pingUsd(model, u) }
    await update($, warm, w => ({ ...w, lastPing }))
    // A ping that wrote more than it read found the cache gone and paid to write it again.
    if (u.cache_read_input_tokens < u.cache_creation_input_tokens) {
      return stopWarm($, 'a ping found the cache already cold')
    }
    return touch($, at)
  }

  const failures = (await read($, warm)).failures + 1
  if (failures >= MAX_FAILURES) return stopWarm($, `${MAX_FAILURES} pings in a row failed`)
  await update($, warm, w => ({ ...w, failures, nextPingAt: at + cfg.retry }))
}

// Once a second: the cache countdown, its warnings, keep-warm's pings and the minute tick.
async function tickOnce($: EngineInterface) {
  const now = await $.clock.now()
  const c = await read($, cache)
  const w = await read($, warm)

  if (c.lastRequestAt !== null) {
    const left = Math.max(0, Math.floor((c.lastRequestAt + cfg.ttl - now) / 1000))
    if (left !== c.secondsLeft) await update($, cache, x => ({ ...x, secondsLeft: left }))
    if (w.until === 0) await warnCache($, left)
  }

  if (w.until !== 0) {
    if (now >= w.until) await stopWarm($, null)
    else if (c.lastRequestAt !== null && now >= c.lastRequestAt + cfg.ttl) await stopWarm($, 'the cache went cold')
    else if (w.nextPingAt !== null && now >= w.nextPingAt && !mem.inFlight && !(await read($, isBusy))) {
      void ping($).catch(() => {})
    }
  }

  const minute = Math.floor(now / 60_000)
  if (minute !== (await read($, tick))) await update($, tick, () => minute)
}

// At 10 and 5 minutes left on a 1-hour cache, while no turn runs (session-band's warning).
async function warnCache($: EngineInterface, left: number) {
  if (cfg.ttl < NOTIFY_MINUTES[0] * 60_000) return
  const due = NOTIFY_MINUTES.filter(m => left > 0 && left <= m * 60)
  if (due.length === 0 || (await read($, isBusy))) return
  const minutes = Math.min(...due)
  const last = await read($, warned)
  if (last !== 0 && last <= minutes) return
  await update($, warned, () => minutes)
  void notifyCacheExpiry($, Math.ceil(left / 60)).catch(() => {})
}

// The session's figures and the plan's windows, from a measurement or `$.session.usage()`.
async function take($: EngineInterface, u: Pick<SessionUsage, 'context' | 'rateLimits' | 'cost'>) {
  // The turn's cost runs live while it runs and is kept as it ended.
  const busy = await read($, isBusy)
  await update($, session, s => {
    const total = u.cost?.usd ?? s.total
    return {
      ...s,
      total,
      context: u.context.percent ?? s.context,
      turnCost: busy && total !== null ? total - s.costAtStart : s.turnCost,
    }
  })
  const windows = u.rateLimits
    .filter(w => Number.isFinite(w.percentUsed))
    .map(w => ({ kind: w.kind, percentUsed: w.percentUsed, ...(w.resetsAt ? { resetsAt: w.resetsAt } : {}) }))
  await update($, plan, () => windows)
  await warnPlan($, windows)
}

async function summarize($: EngineInterface, mine: string) {
  const before = await read($, summary)
  const messages = (await $.session.messages()).filter(m => m.text.trim() !== '').slice(-10)
  const r = await $.model.complete({
    model: 'haiku',
    maxTokens: 300,
    timeoutMs: 20000,
    system:
      'You keep a one-glance summary of a coding session. Plain words, no em dashes, each field at most 70 characters. ' +
      'Reply with JSON only: {"goal","next","waiting"}. "goal": the overall aim of the session (keep the previous goal ' +
      'unless it clearly changed). "next": the next step. "waiting": what the assistant is waiting on from the person, or "".',
    prompt: [
      `Previous summary: ${before ? JSON.stringify(before) : 'none'}`,
      `<transcript>\n${messages.map(m => `[${m.role === 'user' ? 'person' : 'assistant'}] ${m.text.slice(0, 800)}`).join('\n')}\n</transcript>`,
      'Write the summary of the transcript above now: the JSON only, not a reply to it.',
    ].join('\n\n'),
  })
  // A newer turn started while Haiku was writing: this summary is stale.
  if (!r.isAnswered || mem.latest !== mine) return
  const parsed = parseSummary(r.text)
  if (parsed) await update($, summary, () => parsed)
}

export const register: Register = (on, options) => {
  cfg.ttl = (options.cacheLifetime === '5m' ? 5 : 60) * 60_000
  // A ping goes out this long before the cache would go cold: on a 1-hour cache 50 minutes
  // after the last request, as cache-tax does. A failed one is tried again a quarter of that later.
  cfg.lead = cfg.ttl / 6
  cfg.retry = cfg.lead / 4
  const hours = typeof options.keepWarmHours === 'number' && options.keepWarmHours > 0 ? options.keepWarmHours : 2
  cfg.windowMs = hours * 3_600_000
  cfg.hasSummary = options.summaryRow !== false
  cfg.hasHeadsUp = options.headsUp !== false
  mem.ticker?.cancel()
  Object.assign(mem, { ticker: undefined, inFlight: false, lastModel: null, latest: '', asked: '', steps: [] })

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    const usage = await $.session.usage().catch(() => null)
    if (usage) await take($, usage)
    mem.ticker?.cancel()
    mem.ticker = $.clock.every(1000, () => {
      void tickOnce($).catch(() => {})
    })
    return result
  })

  on('session.measure', async ($, e, next) => {
    const result = await next(e)
    await take($, e)
    return result
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.command === undefined && e.isMeta !== true && isPerson(e.origin)) {
      mem.asked = e.text
      await update($, prompts, n => n + 1)
    }
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      const total = (await $.session.usage().catch(() => null))?.cost?.usd
      await update($, session, s => ({ ...s, turn: s.turn + 1, costAtStart: total ?? s.total ?? 0, total: total ?? s.total }))
      await update($, isBusy, () => true)
      mem.latest = e.turnId
      mem.steps = []
      await update($, flags, () => [])
      // The person has answered: what the last turn waited on is no longer theirs to do.
      await update($, summary, r => (r && r.waiting !== '' ? { ...r, waiting: '' } : r))
    }
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined) return yield* next(e)

    // Timed from the response's first item, so time to first token is left out but thinking
    // that streams hidden still counts: output_tokens counts it (session-band's measure).
    const stream = next(e)
    let startedAt: number | null = null
    for await (const chunk of stream) {
      if (startedAt === null) startedAt = await $.clock.now()
      if (chunk.kind === 'stop' && chunk.usage !== null) {
        const tokens = chunk.usage.output_tokens
        const seconds = ((await $.clock.now()) - startedAt) / 1000
        const speed = tokens / seconds
        if (tokens >= MIN_TOKENS && seconds >= MIN_SECONDS && speed <= MAX_SPEED) {
          await update($, session, s => ({ ...s, speed: Math.round(speed) }))
        }
      }
      yield chunk
    }
    const result = await stream.result
    // A request that got no response touched no cache.
    if (result.usage !== null) await touch($, await $.clock.now())
    return result
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (cfg.hasHeadsUp && e.agentId === undefined && mem.steps.length < MAX_STEPS) mem.steps.push(toStep(e, ran))
    return ran
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined) return result

    const now = await $.clock.now()
    if (e.usage?.model) mem.lastModel = e.usage.model
    const usage = await $.session.usage().catch(() => null)
    if (usage) await take($, usage)
    await update($, session, s => ({ ...s, turnCost: s.total === null ? s.turnCost : s.total - s.costAtStart }))
    await update($, isBusy, () => false)
    await update($, warned, () => 0)
    // A turn stopped before it sent anything touched no cache.
    if (e.usage || !e.isAborted) await touch($, now)

    const mine = e.turnId
    mem.latest = mine
    // In the background, so the prompt comes back at once.
    if (cfg.hasSummary) void summarize($, mine).catch(() => {})
    if (cfg.hasHeadsUp && e.reason === 'answer' && e.answer.length >= MIN_REPLY && mem.steps.length > 0 && (await read($, prompts)) > QUIET_PROMPTS) {
      const request = mem.asked
      const log = mem.steps
      void (async () => {
        const found = await findFlags($, request, e.answer, log)
        if (found.length > 0 && mem.latest === mine) await update($, flags, () => found)
      })().catch(() => {})
    }
    return result
  })

  // A summary replaces the chat the cache held: keep-warm has nothing left to keep.
  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) {
      await stopWarm($, 'the chat was compacted')
      await update($, cache, () => ({ lastRequestAt: null, secondsLeft: null }))
    }
    return result
  })

  // /clear (or a resume) starts another conversation in the same process.
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear' || e.reason === 'resume') {
      await stopWarm($, null)
      await update($, session, () => FRESH)
      await update($, cache, () => ({ lastRequestAt: null, secondsLeft: null }))
      await update($, summary, () => null)
      await update($, flags, () => [])
      await update($, prompts, () => 0)
      await update($, isBusy, () => false)
      await update($, warned, () => 0)
      mem.latest = ''
      mem.steps = []
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // The other mods' rows stay, above these: the session row sits right above the prompt.
    const rest = await next(e)
    if (e.props.hasSurvey) return rest

    const s = await read($, session)
    const windows = liveWindows(await read($, plan), await $.clock.now())
    const c = await read($, cache)
    const w = await read($, warm)
    const sum = cfg.hasSummary ? await read($, summary) : null
    const list = await read($, flags)
    await read($, tick)
    const now = await $.clock.now()

    const ui = $.ui.resolve(e)
    const { Box, Button, Text } = ui
    // Icons on the desktop alone: the terminal draws words and text bars.
    const Svg = e.surface === 'desktop' && 'Svg' in ui ? ui.Svg : null
    const icon = (source: string, alt: string) => (Svg ? <Svg source={source} alt={alt} width={ICON_PX} height={ICON_PX} /> : null)
    // Widths in cells: an icon with its gap, a run of text, a Button with its padding.
    const ICON_W = Svg ? ICON_PX / CELL_PX + 1 : 0
    const cells = (text: string) => (Svg ? text.length * TEXT_CELLS : text.length)
    const buttonCells = (label: string) => (Svg ? cells(label) + 2.5 : label.length + 4)
    const room = e.props.bodyColumns - 2

    // The plan's windows: label, percentage and the 5-hour reset time.
    const plans = windows.map(win => {
      const reset = resetTime(win)
      return {
        win,
        label: planLabel(win.kind),
        pct: `${Math.round(win.percentUsed)}%`,
        color: planColor(win.percentUsed),
        resets: win.kind === 'five_hour' && reset !== 0 ? `resets ${countdown(reset - now)}` : null,
      }
    })

    // The narrow plan row: its fields one after another, dropped by priority.
    const planFields = (): Field[] =>
      plans.flatMap(pl => {
        const usage: Field = {
          p: pl.win.kind === 'five_hour' ? 1 : 2,
          width: cells(pl.label) + 1 + cells(pl.pct),
          node: (
            <Box flexDirection="row" alignItems="center" columnGap={1} flexShrink={0}>
              <Text dimColor>{pl.label}</Text>
              <Text bold color={pl.color}>{pl.pct}</Text>
            </Box>
          ),
        }
        if (pl.resets === null) return [usage]
        return [usage, { p: 3, width: cells(pl.resets), node: <Text dimColor>{pl.resets}</Text> }]
      })

    // The wide plan row: one equal part per window, its bar stretched to fill the part less
    // two cells before the next. Null when a bar would get under MIN_BAR cells.
    const planParts = (): RenderNode | null => {
      const share = room / plans.length
      const parts = plans.map(pl => {
        const hasBar = pl.win.kind !== 'spend_limit'
        const fixed = cells(pl.label) + 1 + cells(pl.pct) + (pl.resets === null ? 0 : 1 + cells(pl.resets)) + (hasBar ? 1 : 0)
        return { ...pl, hasBar, bar: Math.floor(share - fixed - 2) }
      })
      if (parts.some(pt => pt.hasBar && pt.bar < MIN_BAR)) return null
      return (
        <Box flexDirection="row" alignItems="center" flexWrap="nowrap" overflow="hidden" paddingX={1}>
          {parts.map(pt => (
            <Box width={`${Math.floor(100 / parts.length)}%`} flexDirection="row" alignItems="center" columnGap={1} flexShrink={0} overflow="hidden">
              <Text dimColor>{pt.label}</Text>
              {!pt.hasBar ? null
              : Svg ? <Svg source={svgBar(pt.win.percentUsed, pt.color, pt.bar * CELL_PX)} alt={`${pt.label} ${pt.pct}`} width={pt.bar * CELL_PX} height={6} />
              : <Text color={pt.color}>{textBar(pt.win.percentUsed, pt.bar)}</Text>}
              <Text bold color={pt.color}>{pt.pct}</Text>
              {pt.resets === null ? null : <Text dimColor>{pt.resets}</Text>}
            </Box>
          ))}
        </Box>
      )
    }

    const cacheLeft = c.lastRequestAt === null ? null : c.secondsLeft
    const cacheColor =
      e.props.isWorking || cacheLeft === null ? null
      : cacheLeft === 0 || cacheLeft * 1000 <= cfg.ttl / 6 ? ALERT
      : cacheLeft * 1000 <= cfg.ttl / 3 ? WARN
      : null
    const cacheText = e.props.isWorking ? '…' : cacheLeft === null ? '—' : cacheLeft === 0 ? 'expired' : mmss(cacheLeft)

    const sessionFields = (st: Stage): Field[] => {
      // From the first turn's start: its speed, cost and context are live while it runs.
      if (s.turn === 0) return []
      const out: Field[] = []
      const turn = String(s.turn)
      out.push({
        p: 4,
        width: cells('Turn') + 1 + cells(turn),
        node: (
          <Box flexDirection="row" alignItems="center" columnGap={1} flexShrink={0}>
            <Text dimColor>Turn</Text>
            <Text bold>{turn}</Text>
          </Box>
        ),
      })

      if (s.speed !== null) {
        const speed = `${s.speed} tok/s`
        out.push({
          p: 3,
          width: ICON_W + cells(speed),
          node: (
            <Box flexDirection="row" alignItems="center" columnGap={1} flexShrink={0}>
              {icon(SPEED_ICON, 'speed')}
              <Text bold>{speed}</Text>
            </Box>
          ),
        })
      }

      if (s.total !== null) {
        const turnCost = st.maxP >= 3 && s.turnCost !== null ? usd(s.turnCost) : null
        out.push({
          p: 2,
          width: ICON_W + (turnCost === null ? 0 : cells(turnCost) + 2 + cells('|')) + cells(usd(s.total)),
          node: (
            <Box flexDirection="row" alignItems="center" columnGap={1} flexShrink={0}>
              {icon(MONEY_ICON, 'cost')}
              {turnCost === null ? null : <Text bold color={MONEY}>{turnCost}</Text>}
              {turnCost === null ? null : <Text dimColor>|</Text>}
              <Text bold>{usd(s.total)}</Text>
            </Box>
          ),
        })
      }

      // The countdown and Keep warm drop together: priority 1.
      const isWarm = w.until !== 0
      if (c.lastRequestAt !== null || isWarm) {
        const canWarm = isWarm || (cacheLeft !== null && cacheLeft > 0)
        const left = countdown(w.until - now)
        const nextPing = w.nextPingAt !== null && w.nextPingAt < w.until ? ` · next ping ${countdown(w.nextPingAt - now)}` : ''
        const label =
          isWarm ? (st.warm === 'full' ? `warm · ${left} left${nextPing}` : `◷ ${left}`)
          : st.warm === 'icon' ? '◷'
          : 'Keep warm'
        const pingCost = isWarm && st.warm === 'full' && w.lastPing ? `last ping ${w.lastPing.usd === null ? 'n/a' : w.lastPing.usd < 0.01 ? '<$0.01' : usd(w.lastPing.usd)}` : null
        out.push({
          p: 1,
          width: (Svg ? ICON_W : cells('cache') + 1) + cells(cacheText) + (canWarm ? 1 + buttonCells(label) : 0) + (pingCost ? 1 + cells(pingCost) : 0),
          node: (
            <Box flexDirection="row" alignItems="center" columnGap={1} flexShrink={0}>
              {Svg ? icon(cacheIcon(cacheColor ?? CACHE), 'cache') : <Text dimColor>cache</Text>}
              <Text bold color={cacheColor ?? undefined}>{cacheText}</Text>
              {canWarm ? <Button key="keep-warm" label={label} onPress={() => toggleWarm($)} /> : null}
              {pingCost ? <Text dimColor>{pingCost}</Text> : null}
            </Box>
          ),
        })
      }

      if (s.context !== null) {
        const pct = `${s.context}%`
        const color = contextColor(s.context)
        out.push({
          p: 2,
          width: (Svg ? ICON_W : cells('ctx') + 1) + (st.bars ? (Svg ? 80 / CELL_PX + 1 : 6) : 0) + cells(pct),
          isEnd: true,
          node: (
            <Box flexDirection="row" alignItems="center" columnGap={1} flexShrink={0}>
              {Svg ? icon(contextIcon(s.context), 'context') : <Text dimColor>ctx</Text>}
              {st.bars ? (Svg ? <Svg source={svgBar(s.context, color, 80)} alt={`context ${pct}`} width={80} height={6} /> : <Text color={color}>{textBar(s.context)}</Text>) : null}
              <Text bold>{pct}</Text>
            </Box>
          ),
        })
      }
      return out
    }

    // Each row takes the first stage it fits, and fields of one priority drop together in both
    // rows; the summary and heads-up lines truncate rather than count.
    const rowWidth = (fields: Field[], gap: number) =>
      fields.reduce((sum, f) => sum + f.width, 0) + gap * Math.max(0, fields.length - 1 + (fields.some(f => f.isEnd) ? 1 : 0))
    const last = STAGES[STAGES.length - 1]!
    const sessionStage = STAGES.find(st => rowWidth(sessionFields(st).filter(f => f.p <= st.maxP), st.gap) <= room) ?? last
    const planStage = STAGES.find(st => rowWidth(planFields().filter(f => f.p <= st.maxP), st.gap) <= room) ?? last
    const maxP = Math.min(sessionStage.maxP, planStage.maxP)
    const keptSession = sessionFields(sessionStage).filter(f => f.p <= maxP)
    const keptPlan = planFields().filter(f => f.p <= maxP)
    // The wide plan row holds the reset time, priority 3.
    const wide = plans.length > 0 && maxP >= 3 ? planParts() : null

    // Gaps between the fields, and a spring that pushes the end fields to the right (session-band's row).
    const row = (fields: Field[], gap: number) => {
      const end = fields.filter(f => f.isEnd)
      return (
        <Box flexDirection="row" alignItems="center" columnGap={gap} flexWrap="nowrap" overflow="hidden" paddingX={1}>
          {fields.filter(f => !f.isEnd).map(f => f.node)}
          {end.length > 0 ? <Box flexGrow={1} flexShrink={1} /> : null}
          {end.map(f => f.node)}
        </Box>
      )
    }

    const rows: RenderNode[] = []
    if (list.length > 0) {
      rows.push(
        <Box flexDirection="column" paddingX={1}>
          {list.map(flag => (
            <Text>
              <Text color="warning" bold>
                heads-up{' '}
              </Text>
              {flag}
            </Text>
          ))}
          <Button key="dismiss" label="Dismiss" role="dismiss" onPress={() => update($, flags, () => [])} />
        </Box>,
      )
    }
    if (sum && maxP >= 4) {
      rows.push(
        <Box paddingX={1}>
          <Text wrap="truncate-end">
            <Text color="cyan" bold>{'◆ Goal: '}</Text>
            {sum.goal}
            {sum.next !== '' ? <Text dimColor>{' · next: '}</Text> : null}
            {sum.next !== '' ? sum.next : null}
            {sum.waiting !== '' ? <Text bold>{' · waiting on you: '}</Text> : null}
            {sum.waiting !== '' ? sum.waiting : null}
          </Text>
        </Box>,
      )
    }
    if (wide) rows.push(wide)
    else if (keptPlan.length > 0) rows.push(row(keptPlan, planStage.gap))
    if (keptSession.length > 0) rows.push(row(keptSession, sessionStage.gap))
    if (rows.length === 0) return rest

    // Claude Code's own placeholder ({ type: 'engine' }) is never nested: the desktop drops a band that nests it.
    const below = rest && rest.type !== 'engine' ? rest : null
    return (
      <Box flexDirection="column">
        {below}
        {rows}
      </Box>
    )
  })
}

// One toast per plan window per reset period, once it passes PLAN_WARN_AT (usage-meter's, MIT).
async function warnPlan($: EngineInterface, windows: PlanWindow[]) {
  const done = await read($, planWarned)
  const now = await $.clock.now()
  const fresh: Record<string, number> = {}
  const rearm: string[] = []
  for (const w of windows) {
    const resetMs = resetTime(w)
    if (w.percentUsed < PLAN_WARN_AT) {
      // With no reset time, dropping back under the line is the only sign of a new period.
      if (resetMs === 0 && done[w.kind] !== undefined) rearm.push(w.kind)
      continue
    }
    const last = done[w.kind]
    // A reset time that moved on by more than half an hour is a new period.
    if (last !== undefined && resetMs <= last + 30 * 60_000) continue
    fresh[w.kind] = resetMs
    const when = resetMs > 0 ? `, resets in ${countdown(resetMs - now)}` : ''
    const what = w.kind === 'spend_limit' ? 'Spend limit' : `${planLabel(w.kind)} usage limit`
    $.ui.toast(`${what} at ${Math.round(w.percentUsed)}%${when}`)
  }
  if (Object.keys(fresh).length > 0 || rearm.length > 0) {
    await update($, planWarned, old => {
      const next = { ...old, ...fresh }
      for (const kind of rearm) delete next[kind]
      return next
    })
  }
}

// Claude Code's own notification, which also reaches the phone over Remote Control; it is
// skipped while the person is at this session, and a toast says it instead (session-band's fallback).
async function notifyCacheExpiry($: EngineInterface, minutes: number) {
  const project = (await $.session.cwd()).split('/').filter(Boolean).pop() ?? 'session'
  const text = `${project}: Prompt cache expires in ${minutes} min`
  const sent = await $.tool.call({ tool: 'PushNotification', message: text, status: 'proactive' }).catch(() => null)
  const isDelivered =
    sent !== null &&
    sent.deny === undefined &&
    sent.isError !== true &&
    (sent.result.pushSent === true || sent.result.localSent === true)
  if (!isDelivered) $.ui.toast(`⏳ ${text}`, { timeoutMs: 30000 })
}

// The person's own prompts: typed, sent through the phone or web bridge, or from an SDK host.
function isPerson(origin: PromptOrigin): boolean {
  return origin.kind === 'composer' || origin.kind === 'bridge' || origin.kind === 'sdk'
}

function toStep(e: ToolCallInput, ran: ToolCallResult): Step {
  const input = e as unknown as Record<string, unknown>
  const what = input.command ?? input.file_path ?? input.notebook_path ?? input.pattern ?? input.url ?? input.description ?? ''
  const isFailed = ran.deny !== undefined || ran.isError === true
  const said = ran.deny ?? ran.text ?? ''
  return {
    tool: e.tool,
    what: String(what).slice(0, 200),
    isFailed,
    // A failure's text says why; the end of a Bash run says how it ended (a test summary).
    output: isFailed ? said.slice(0, 300) : e.tool === 'Bash' ? said.slice(-200) : '',
  }
}

// One Haiku call over the turn; [] when it finds nothing, or fails. The check is heads-up's.
async function findFlags($: EngineInterface, request: string, reply: string, log: Step[]): Promise<string[]> {
  const calls = log
    .map((s, i) => {
      const line = `${i + 1}. ${s.tool} ${s.what}${s.isFailed ? ' [FAILED]' : ''}`
      return s.output === '' ? line : `${line}\n   ${s.output.replace(/\s+/g, ' ')}`
    })
    .join('\n')
  const prompt = [
    'Claude just finished a turn of work. Name at most two facts the person might miss. Only these count:',
    '- a tool call that failed, was not fixed by a later call, and the reply does not mention it',
    '- files changed beyond what the request asked for',
    '- code changed, and no test or build ran after the change',
    '- a risky step taken: a force push, a hard reset, deleted files, a migration, a publish or deploy, a change outside the project',
    'Do not list guesses or assumptions the reply made, style advice, or anything the reply already tells the person.',
    'Answer with only a JSON array of at most two strings, each under 20 words, naming the file, command or tool. Answer [] when nothing is worth flagging.',
    '',
    `Request: ${request.slice(0, 2000)}`,
    `Tool calls this turn:\n${calls.slice(0, 8000)}`,
    `Reply: ${reply.slice(0, 6000)}`,
  ].join('\n')
  const r = await $.model.complete({ model: 'haiku', prompt, maxTokens: 250, timeoutMs: 20000 })
  return r.isAnswered ? parseFlags(r.text) : []
}

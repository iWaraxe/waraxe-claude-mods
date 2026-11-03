export type Session = {
  /** Main-thread turns started: the session row shows from the first. */
  turn: number
  /** Output tokens per second of the last timed reply; null before one. */
  speed: number | null
  /** The last turn's cost in US dollars, live while it runs; null before the first. */
  turnCost: number | null
  /** The session's cost in US dollars; null where the host keeps no ledger. */
  total: number | null
  /** Context fill, 0 to 100; null before a response reported one. */
  context: number | null
  /** The session's cost when the running or last turn started. */
  costAtStart: number
}

export type PlanWindow = { kind: string; percentUsed: number; resetsAt?: string }

export type Cache = {
  /** The end of the last main-thread request or ping; null before the first answer and after /clear or compaction. */
  lastRequestAt: number | null
  /** Seconds until the cache goes cold, ticked once a second; null without a countdown. */
  secondsLeft: number | null
}

export type Warm = {
  /** When the keep-warm window ends; 0 while keep-warm is off. */
  until: number
  /** When the next ping is due; null while none is due. */
  nextPingAt: number | null
  /** Pings that failed in a row. */
  failures: number
  /** The last ping: when it landed and its cost in US dollars (null for a model with no price). */
  lastPing: { at: number; usd: number | null } | null
}

export type Summary = { goal: string; next: string; waiting: string }

declare module 'claude-code' {
  interface PluginState {
    'status-banner': {
      session: Session
      plan: PlanWindow[]
      cache: Cache
      warm: Warm
      summary: Summary | null
      flags: string[]
      prompts: number
      isBusy: boolean
      tick: number
      warned: number
      planWarned: Record<string, number>
    }
  }
}

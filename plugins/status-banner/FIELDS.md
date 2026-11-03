# Combined banner: field list

Agreed on 2026-10-30 (see [Decisions](#decisions)), before status-banner was written. The code differs in places, for example gaps instead of dots between fields and when the speed timer starts; [plugins/status-banner/README.md](README.md) describes what it does now. This is the list of fields one combined banner above the prompt would show, so it can replace the separate status bands without them hiding each other.

- **Status rows only.** Information you glance at. Rows you act on stay in their own mods: blast-radius (approve a risky command), secret-box (paste a secret), reflect-mod (save a rule), prompt-queue (queued prompts) and replay-theater (step through edits).
- **Banner only.** Chat output stays as it is for now.
- **Sources:** the plugin list in BANNER-AND-OUTPUT-MODS.md (in the claude-mods-demo repo), the Claude Code API types, and how session-band, usage-meter, cache-tax, mission-control, where-am-i and heads-up compute their values today.

## Layout

Up to three rows, plus a heads-up line when there is something to flag. A row with nothing to show is left out, never drawn empty. The session row sits right above the prompt.

```text
Goal: fix band rows · next: fix replay · waiting on you: go-ahead      after a turn
5h ▮▯▯▯▯ 8% resets 1h08 · 7d ▮▯▯▯▯ 13%                                 with a plan reading
Turn 6 · 93 tok/s · $0.14 | $6.08 · cache 58:40 [Keep warm] · ctx 26%  from the first turn
```

mission-control keeps its own row for what Claude is doing during a turn.

In a narrow window, the same banner keeps only the top-priority fields:

```text
5h 8% · 7d 13%
cache 58:40 [◷] · $6.08 · ctx 26%
```

## Fields

**Narrow priority:** 1 stays longest; 4 drops first. Fields of one priority drop together.

### Session row

| # | Field | Shows | Claude Code data | Appears | Narrow priority | Replaces |
|---|---|---|---|---|---|---|
| 1 | Turn | `Turn 6` | A count of main-thread `turn.start` events (no `agentId`) | From the first turn | 4 | session-band |
| 2 | Output speed | `93 tok/s` for the last reply | `turn.step` stream: the stop chunk's `usage.output_tokens` over the seconds since the request began; replies under 20 tokens or 0.5 s are skipped | After the first timed reply | 3 | session-band |
| 3 | Turn cost | `$0.14` | `$.session.usage().cost.usd` at the turn's end minus at its start | From the first turn | 3 | session-band |
| 4 | Session cost | `$6.08` | `session.measure` and `$.session.usage()`: `cost.usd` | From the first turn | 2 | session-band, usage-meter |
| 5 | Cache countdown | `58:40`, amber at 20 min left, red at 10, then `expired`; `…` while a turn runs | The end of the last main-thread request (`turn.step`, `turn.complete`) plus the cache lifetime, ticked by `$.clock.every` | After the first request | 1 | session-band, cache-tax's row |
| 6 | Keep-warm button | `Keep warm`; while on, `warm · 1h29 left · next ping 4m` | See [Keep-warm button](#keep-warm-button) | With the cache countdown | 1 (shrinks to an icon) | cache-tax's `/keepwarm` |
| 7 | Context fill | `ctx 26%`, plus a small bar when wide | `session.measure` and `$.session.usage()`: `context.percent` (`tokens` over `window`) | From the first turn | 2 | session-band |

### Plan row

| # | Field | Shows | Claude Code data | Appears | Narrow priority | Replaces |
|---|---|---|---|---|---|---|
| 8 | 5-hour usage | A small bar and `8%`: green under 75%, yellow from 75%, red from 90% | `rateLimits` entry `five_hour`, `percentUsed` (`session.measure`, `$.session.usage()`) | When a reading exists (subscriptions only) | 1 | usage-meter, skins |
| 9 | 5-hour reset | `resets 1h08` | `five_hour.resetsAt` minus now; hidden once past, until the next reading | With the 5-hour usage | 3 | usage-meter |
| 10 | 7-day usage | A small bar and `13%`, same colors | `rateLimits` entry `seven_day` | When a reading exists | 2 | usage-meter |
| 11 | Spend limit | `spend 40%` | `rateLimits` entry `spend_limit` | Only behind a Claude gateway that reports it | 2 | usage-meter |

### Activity row: dropped

Fields 12 (what Claude is doing now) and 13 (the turn's tool, agent and file counts) are left out. mission-control stays enabled for its pane, and its own band row already shows them.

### Summary row

| # | Field | Shows | Claude Code data | Appears | Narrow priority | Replaces |
|---|---|---|---|---|---|---|
| 14 | Goal, next, waiting on you | `Goal: … · next: … · waiting on you: …` | One small model call (`$.model.complete`, Haiku) per turn over the transcript (`$.session.messages`) | After each turn | 4 | where-am-i |
| 15 | Heads-up | Up to two things you might miss after a long turn (a failed tool call the reply skips, extra files changed, no test run, a risky step), with Dismiss | Tool calls and results during the turn, then one small model call | After a long turn, only when something is found | Own line, never dropped while shown | heads-up |

Fields 14 and 15 are on. Each costs one small model call per turn, and a plugin option turns either off.

### Alerts outside the banner

These are behaviours of today's mods, kept as they are:

- A toast when a plan window passes 90% (usage-meter).
- A notification at 10 and 5 minutes before the cache goes cold, while no turn runs (session-band).

## Keep-warm button

**Decided (2026-10-30):** the combined banner sends its own pings, written by us with cache-tax's MIT code as a reference. cache-tax stays enabled only for its guard against expensive cold sends. Its `/keepwarm` is not used: arming both would ping twice.

**What it does.** One press turns keep-warm on for a window (2 hours by default, set in the plugin options). A second press turns it off. While it is on, the label shows the time left in the window and the time to the next ping.

**How it works.** Shortly before the cache would go cold, a background request repeats the main thread's last request with one short line after it (`$.model.fork`). The API reads the chat from the cache and the cache's clock starts again. The fork never writes to your transcript. cache-tax pings 50 minutes after the last request on a one-hour cache; cache-clock pinged 45 seconds before expiry.

**What it costs.** Each ping reads the whole chat at the cache-read price, about 5–10% of rewriting it, plus a one-word reply. The banner shows the last ping's cost. A cold rewrite of a large chat costs far more: cache-tax recorded $6.28 for one.

**When it stops:**
- the window ends, or you press the button again;
- three pings in a row fail;
- the cache is gone anyway (`/clear` or compaction).

**Cache lifetime.** Claude Code does not report the lifetime as a general value; it appears only while switching models. Like session-band and cache-tax, the banner assumes one hour, the default for subscriptions. A plugin option sets five minutes for API-key and cloud-provider sessions.

## Rules the combined banner follows

- One band hook. It calls `next(e)` once and keeps what it returns, so the interactive rows from other mods still show. It never nests Claude Code's placeholder element (`{ type: 'engine' }`).
- It yields to a survey (`hasSurvey`) like every band.
- It draws on the terminal and the desktop app: icons on the desktop, text on the terminal.
- Model calls only for fields 14 and 15, one each per turn.
- Colors mean one thing each: amber and red only for warnings (cache running out, plan usage high).

## Left out, and why

| Today's band | Why it is not a field |
|---|---|
| jev-skill-suggestion | Its band was Jev's own scoring view, tied to its TypeSafe key and modes. The mod has since been removed from this repository (2026-10-30). |
| recording-mode's REC badge | The badge belongs with recording-mode's masking. It stays in that mod. |
| helper-desk's task bar (benai-mods) | It shows a plan Claude keeps through helper-desk's own tool. It stays in that mod. |
| Model name and effort | Claude Code's own row under the prompt already shows them. |

## What replacing the old bands means

Once the combined banner works, these would be disabled (not uninstalled): session-band, usage-meter, where-am-i and heads-up. Two stay enabled: mission-control, for its pane and its activity row, and cache-tax, for its cold-send guard with its `/keepwarm` left off. The combined banner is our code to maintain, and those plugins' upstream fixes stop reaching us (see BANNER-AND-OUTPUT-MODS.md (in the claude-mods-demo repo), section 5).

## Decisions

Agreed on 2026-10-30:

1. **Summary row and heads-up:** both on (fields 14 and 15), each with a plugin option to turn it off.
2. **Keep-warm:** built into the combined banner, with cache-tax's MIT code as a reference. cache-tax stays enabled only for its cold-send guard.
3. **Keep-warm window:** 2 hours per press, changeable in the plugin options.
4. **Jev and the REC badge:** not in the combined banner. The REC badge stays in recording-mode; Jev has since been removed from this repository.
5. **Activity row:** dropped. mission-control's own row covers it.

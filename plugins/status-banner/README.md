# status-banner

## What it does

One banner above the prompt in place of four separate bands (session-band, usage-meter, where-am-i and heads-up), so they no longer hide each other. It draws up to three rows, plus a heads-up line when there is something to flag:

```text
◆ Goal: fix band rows · next: fix replay · waiting on you: go-ahead              after a turn
5h ▮▮▯▯▯▯▯▯▯▯▯▯▯▯ 8% resets 1h08   7d ▮▮▯▯▯▯▯▯▯▯▯▯▯▯▯▯▯▯▯▯▯▯ 13%                 with a plan reading
Turn 6   93 tok/s   $0.14 | $6.08   cache 58:40 [Keep warm]          ctx 26%  from the first turn
```

The session row sits right above the prompt. A row with nothing to show is left out. Rows that other mods draw in the band (blast-radius, prompt-queue, replay-theater, mission-control's activity row) stay, above these rows.

The session row takes session-band's look at its own text size: bold figures, 22px icons on the desktop, gaps instead of dots, and context fill at the row's right end. The plan row gives each window an equal part of the row, 5-hour on the left and 7-day on the right, and stretches each bar to fill its part.

On the desktop app the fields carry icons and bars; on the terminal they are words and text bars. VS Code and mobile have no band above the prompt, so they show nothing.

The field list agreed before the code was written, with the data behind each field, is in [FIELDS.md](FIELDS.md). Where the two differ, this README and the code are current.

| Row | Field | Shows | Narrow priority |
|---|---|---|---|
| Session | Turn | `Turn 6`: main-thread turns started, the number in bold | 4 |
| Session | Output speed | `93 tok/s` for the last reply (replies under 20 tokens or 0.5 s, or faster than 1,000 tok/s, are skipped) | 3 |
| Session | Turn cost | `$0.14`: session cost at the turn's end minus at its start | 3 |
| Session | Session cost | `$6.08` | 2 |
| Session | Cache countdown | `58:40` since the last main-thread request; amber at 20 minutes left, red at 10, then `expired`; `…` while a turn runs | 1 |
| Session | Keep warm | A button, shown while the countdown runs or keep-warm is on, so not before the first request or at `expired`; while on, `warm · 1h29 left · next ping 4m` and the last ping's cost, shortened to `◷ 1h29` before any field drops | 1 (an icon, `◷`, when narrow) |
| Session | Context fill | `ctx 26%` at the row's right end, with a bar when wide: green, amber from 65%, red from 85% | 2 |
| Plan | 5-hour usage | The left part: a bar stretched to fill it and `8%`, green under 75%, yellow from 75%, red from 90% | 1 |
| Plan | 5-hour reset | `resets 1h08` | 3 |
| Plan | 7-day usage | The right part: a stretched bar and `13%`, same colors | 2 |
| Plan | Spend limit | `spend 40%`, only behind a Claude gateway that reports it | 2 |
| Summary | Goal, next, waiting on you | `◆ Goal:` in teal (where-am-i's label), from one Haiku call after each turn over the last ten messages | 4 |
| Heads-up | Up to two things you might miss | After a long turn, with Dismiss | never dropped |

**Narrow windows.** As the window narrows the banner first drops the context bar, then tightens the gaps and shortens Keep warm's label while it is on, then drops the priority-4 fields (the turn number and the summary row), then priority 3, then priority 2. Fields of one priority drop together in both rows. The plan row keeps its two parts while each bar gets at least 6 cells, and otherwise lists its fields one after another. On the desktop, widths are counted at about 0.9 of a column per character of text and about 8 pixels per column, measured on session-band's and helper-desk's rows, so a desktop window of about 66 columns keeps every session field.

The plan row appears only when Claude Code has a rate-limit reading, which is on subscriptions. A plan window past its reset time is hidden until the next reading, since its percentage is stale by then.

## Keep warm

One press keeps the prompt cache warm for 2 hours (a plugin option). A second press turns it off.

Shortly before the cache would go cold, a background request repeats the main thread's last request with one short line after it (`$.model.fork`): 50 minutes after the last request on a 1-hour cache. The API reads the chat from the cache, so the cache's clock starts again and the countdown with it. The fork never writes to your transcript. A turn running at that moment holds the ping; its end starts the 50 minutes again.

**What it costs.** Each ping reads the whole chat at the cache-read price, about 5 to 10% of rewriting it, plus a one-word reply. The banner shows the last ping's cost, priced from the model's list price (n/a for a model the table does not know). A cold rewrite of a large chat costs far more.

**It stops when:**

- the window ends, or you press the button again;
- three pings in a row fail (a failed ping is tried again after 2.5 minutes on a 1-hour cache, 12.5 seconds on a 5-minute one);
- a ping finds the cache already gone (it read less than it wrote);
- the cache went cold anyway (the computer slept past it);
- `/clear` or a resume starts another chat, or the chat is compacted.

A stop shows a toast, except when the window ends, when you press the button, and when `/clear` or a resume starts another chat.

**Cache lifetime.** Claude Code does not report it, so the banner assumes one hour, the default for subscriptions. Set the `cacheLifetime` option to `5m` for API-key and cloud-provider sessions: the countdown then starts at 5:00, it turns amber at 1:40 and red at 0:50, and pings go out 50 seconds before expiry.

**With cache-tax.** Leave cache-tax enabled for its guard against expensive cold sends, and do not use its `/keepwarm`: both would ping.

## Alerts outside the banner

- A toast when a plan window passes 90%, once per reset period (from usage-meter).
- A notification at 10 and 5 minutes before a 1-hour cache goes cold, while no turn runs and keep-warm is off (from session-band). It goes through Claude Code's own notification, which also reaches your phone over Remote Control; when that is not delivered (for example while you are at this session), a toast says it instead.

## Options

Set them in `/config` (one row each), or with `/plugin configure status-banner@waraxe-claude-mods` in a terminal session.

| Option | Default | What it does |
|---|---|---|
| `keepWarmHours` | 2 | How long one press of Keep warm lasts, in hours |
| `cacheLifetime` | `1h` | `1h` for subscriptions, `5m` for API-key and cloud-provider sessions |
| `summaryRow` | on | The summary row and its Haiku call after each turn |
| `headsUp` | on | The heads-up line and its Haiku call after a long turn |

## Cost

- **Summary row:** one Haiku call after each main-thread turn, in the background: the last ten messages (800 characters each) and the previous summary, up to 300 output tokens.
- **Heads-up:** one Haiku call after a turn only when all hold: it is past the third prompt of the chat, the reply is at least 300 characters, it ended with an answer, and Claude used a tool. It sends up to about 17,000 characters and asks for up to 250 output tokens. It looks for a failed tool call the reply skips, files changed beyond the request, code changed with no test or build after it, and a risky step.
- **Keep warm:** one ping per idle 50 minutes while it is on (see above).

Everything else is read from Claude Code's own figures (`session.measure`, `$.session.usage()`, the streamed reply), with no model call.

## Replacing the old bands

On 2026-10-30 session-band was uninstalled, and usage-meter, where-am-i and heads-up were disabled (not uninstalled), so this banner is the only one showing their information.

Keep mission-control for its pane and its activity row, and cache-tax for its cold-send guard. This banner is our own code: fixes made upstream to the mods it replaces do not reach it.

What this banner leaves out from them: session-band's `×`, `/session_data` and its macOS notifier app; where-am-i's "now" line (mission-control's row covers it) and `/where`; usage-meter's band order file; heads-up's `/heads-up` switch (the `headsUp` option replaces it, and it is on by default).

## Limits

- The cache countdown starts at the end of each main-thread request and assumes the lifetime you set. It cannot see a cache that the API dropped early.
- The turn number, costs and summary start over at `/clear`. The session cost is Claude Code's own ledger, so it may include the summary and heads-up calls.
- Ping prices come from a table of list prices (October 2026). A model it does not know shows `n/a`.
- Haiku can miss something or flag something harmless: read a heads-up as a hint to check.
- The summary and heads-up see only the main conversation, not what subagents did inside.

## Credits

Code and approaches taken from other MIT mods in this repository:

- **session-band** by JohnnyVizz (MIT, [JohnnyVizz/claude-kit](https://github.com/JohnnyVizz/claude-kit)): the speed timing, the desktop icons and the cache-expiry notification with its toast fallback.
- **usage-meter** and **where-am-i** by Hamza Zafar (MIT, [hamzafer/claude-code-mods](https://github.com/hamzafer/claude-code-mods)): the reset countdown format, the 90% plan toasts, the control-character filter and the summary's prompt and parsing.
- **cache-tax** by Karan Bansal (MIT, [karanb192/cache-tax](https://github.com/karanb192/cache-tax)): keep-warm pings through `$.model.fork`, the 50-minute ping on a 1-hour cache, the price table and the ping's cost formula.
- **heads-up** (built here): the check after a long turn, its prompt and its Dismiss line.

Their copyright notices are in [LICENSE](LICENSE).

## Install

At the prompt of a terminal session:

```text
/plugin install status-banner --marketplace iWaraxe/waraxe-claude-mods
```

From a shell, and the rest of the install notes, see [INSTRUCTIONS.md](INSTRUCTIONS.md).

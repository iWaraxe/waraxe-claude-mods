# status-banner: how it works

The field list agreed before the code is [FIELDS.md](FIELDS.md); where the two differ, [README.md](README.md) and the code are current.

status-banner draws one banner above the prompt with three rows: the plan's usage, the session's figures and a summary of where the work stands, plus a heads-up line after a long turn. It stands in for session-band, usage-meter, where-am-i and heads-up, which each drew a band of their own, and it keeps the prompt cache warm on request.

It shows how one band hook can carry several mods' worth of fields: every value lives in `$.state`, one ticker moves the clocks, and the band hook calls `next(e)` once and keeps what it returns, so the other mods' rows still show.

## How it was built

1. Declare every value the band reads in `types/index.d.ts`
2. Take the session's cost, context and plan windows from `session.measure` and `$.session.usage()`
3. Count turns at `turn.start`, time the reply in `turn.step`, close the turn's cost at `turn.complete`
4. Restart the cache countdown at the end of each main-thread request
5. Tick once a second: the countdown, the 10 and 5 minute warnings, and a keep-warm ping when one is due
6. Ping with `$.model.fork`, price it, and stop on the window's end, three failures, a cold cache, `/clear` or compaction
7. Ask Haiku for the summary after each turn, and for a heads-up after a long one
8. Draw the rows, dropping the lowest-priority fields until each row fits the band's width

The code is in `hooks/register.tsx` (hooks and drawing) and `hooks/format.ts` (formats, prices and model replies); `tests/status-banner.test.ts` covers each row, the narrow-window drops and keep-warm's timing.

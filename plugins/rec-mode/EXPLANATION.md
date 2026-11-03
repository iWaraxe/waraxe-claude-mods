# rec-mode: how it works

It builds on [recording-mode](https://github.com/nateherkai/claude-code-mods) by Nate Herk (MIT), the mod this one starts from.

rec-mode is recording-mode plus three things. While REC is on it silences every other mod's sound. It always shows a badge above the prompt, grey ○ REC while off and a red pulsing ● REC with a Stop button while on, and pressing the badge switches REC. And a small script, `bin/rec`, switches it from outside Claude Code, so a macOS Shortcuts key can turn it on before a meeting. `hooks/privacy.mjs`, which finds what to mask, is recording-mode's file unchanged.

## How it was built

1. Start from recording-mode: the same /rec command, masking, closed files and note to Claude
2. Keep the switch in its own file, `~/.claude/mods-data/rec-mode/state.json`, which every chat reads every 3 seconds
3. Leave REC as it was when that file can't be read (half written), instead of turning it off
4. Hook `audio.play` and `audio.speak`: read the switch first, then, while REC is on, answer the call as if it had played
5. Hook `process.run` too, for a mod that runs `say` or `afplay` itself (narrator does): answer those two commands with a clean exit, and pass every other command on before reading the switch
6. Draw the badge in both states, with one Button that switches REC
7. Write `bin/rec`, which writes the same file whole and moves it into place, and shows a macOS notification

## Why the mute works without touching spoken-alerts

A mod's call on `$` is an event of its own. `$.audio.play(...)` from spoken-alerts runs through the hooks of the other installed mods and then reaches Claude Code, which plays it. Any hook on the way can pass it on, change it, refuse it with `{ deny }`, or answer it with `{ value }`. rec-mode answers with `{ value }`: the call resolves as if the clip had played. A refusal would make spoken-alerts fall back to the Mac voice and show a "voice failed" toast, so an answer is the quiet choice.

narrator makes no `$.audio` call. It runs macOS `say` with `$.process.run`, which is a `process.run` event, so 0.1.0, with only the two audio hooks, let it speak while REC was on. 0.1.1 hooks `process.run` as well and answers `say` and `afplay` (with or without a folder in front) with exit code 0 and no output, so narrator neither speaks nor shows its "could not run macOS say" toast.

Turning spoken-alerts off in settings (`claude plugin disable`) was the other way. It was not used because it changes your settings file and only takes effect when a chat reloads its mods.

## How it was checked

- `claude plugin test plugins/rec-mode`: 8 tests for the badge in both states and on desktop, the badge's button, /rec, /rec strict and /rec off, a switch written by `bin/rec`, and a half-written switch file. The test kit can't stand for another mod making a sound (a test's `$` has no `$.audio` or `$.process`), so the mute is checked in real sessions below.
- Two test mods in headless sessions, one that played a clip and one that hooked `audio.play`: the hook saw the other mod's calls in every load order, named the caller (`origin.plugin`), and its answer made the caller's call resolve normally.
- Real sessions with the installed spoken-alerts (OpenAI voice) and a test mod that logged every sound and turned it into silence:
  - REC off: spoken-alerts' chime and voice clip reached Claude Code.
  - REC on, switched by `bin/rec on`: both were answered by rec-mode and never reached Claude Code, in both load orders. spoken-alerts made no fallback call to the Mac voice.
  - One session, REC on for the first turn and `bin/rec off` before the second: the first turn's sounds were silenced, the second turn's played.
- narrator in headless sessions, with `/narrator on`, a fake `say` first on the `PATH` that logged its words without a sound, spoken-alerts turned off, and rec-mode's switch file in a scratch folder (`USERPROFILE`):
  - REC on, rec-mode 0.1.0: narrator's `say` ran with the reply.
  - REC on, rec-mode 0.1.1: `say` never ran.
  - REC off, rec-mode 0.1.1: `say` ran with the reply.

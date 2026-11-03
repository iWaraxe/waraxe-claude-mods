# effort-picker: how it works

It replaces the rule-based effort-picker from the training marketplace: Haiku decides instead of word patterns, and you see every choice.

## How it was built

1. **Wait on the first model request.** `prompt.submit` notes a typed prompt and `turn.start` ties it to its turn. The wait happens in `turn.step` at index 0, because that is the first place the session's real level is known, as `e.effort`. Your message is already in the chat by then.
2. **Ask Haiku.** `$.model.complete` sends the message and the end of the last reply, under a system prompt that paraphrases Anthropic's article and the effort table in the Claude Code docs. It answers one line, `level: reason`, which `parseReply` reads. No word patterns pick the level.
3. **Hold with a dialog.** A hook has 10 seconds of its own time, but a `$` call in flight doesn't count, so `$.ui.ask` can wait as long as you take. It also relays to Remote Control and fails cleanly when nobody can be asked.
4. **Draw the row.** A `ui.render` hook on `AbovePrompt` adds the row above whatever other mods draw, and leaves out the engine's own placeholder element, which would make the desktop app drop the band.
5. **Let a click close the dialog.** The dialog has no cancel. But the mod has its own `tool.call` hook on `AskUserQuestion`, and it races `next(e)` against the click. Answering first ends the call and closes the dialog.
6. **Send the turn at that level.** Each main-chat `turn.step` passes on `{ ...e, effort }`, so the level lasts one turn and your saved setting is never written.

## What was tried first

Probes in a real session settled the shape:

| Where the buttons sit | Terminal | Desktop app |
|---|---|---|
| Banner row alone | Clicks only | Clicks only, Enter never arrives |
| Pane opened with `focus` and `autoFocus` | Enter works | No focus, no press |
| Question dialog | Enter works | Enter works, 4 options at most |
| Banner row plus dialog | Dialog only: the terminal hides the banner while a dialog is open | Works |

spoken-alerts skips this one dialog, or it would speak on every prompt.

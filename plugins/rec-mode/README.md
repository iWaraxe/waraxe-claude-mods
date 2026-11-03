# rec-mode

Run `/rec` before you record your screen or share it in a meeting. It hides what should stay private and keeps every mod quiet until you turn it off. It is built on [recording-mode](https://github.com/nateherkai/claude-code-mods) by Nate Herk (MIT) and replaces it: install one or the other, not both.

## What it does

While REC is on, in every open chat:

- **Masks on screen:** API keys and tokens, every value in a `.env` file in the project folder or its parents, emails, names, phone numbers, street addresses, card, account and ID numbers, money, and figures next to business words (revenue, margin, payroll and so on). `/rec strict` also masks every large figure and percentage.
- **Hides whole results** from mail, chat, task, calendar, file, CRM and finance tools. Claude still gets the real result. Only the screen changes.
- **Keeps files closed:** `.env` files, credentials, SSH and cloud keys, Claude's memory folder, and finance documents (payroll, invoices, contracts, budgets, forecasts, tax files). Finance tools like QuickBooks stay closed too. Claude is told it can't open them while recording.
- **Tells Claude:** each prompt carries a hidden note to keep names, figures and internal plans out of its replies.
- **Silences every mod's sound:** spoken-alerts' chimes and voices, narrator, and any other mod's chime. The moment REC turns off, they play again.
- **Shows its state:** a badge above the prompt. Grey **○ REC** while off. Red, pulsing **● REC · masked · mod sounds off · Stop** while on. The footer also shows ● REC while on.

## Switching it on and off

| How | Turn on | Turn off |
|---|---|---|
| Command | `/rec`, or `/rec strict` | `/rec` again, or `/rec off` |
| Badge (desktop app) | Click **○ REC** | Click **Stop** |
| Mac hotkey | Press your key (set it up below) | Press it again |

Every open chat follows within 3 seconds. A mod's sound checks the switch at the moment it would play, so no alert slips through in those 3 seconds.

### Set up the Mac hotkey

The desktop app can't bind a key to a slash command, so the hotkey lives in macOS instead. It works even while Zoom or another app is in front.

1. Open the **Shortcuts** app and choose **File > New Shortcut**.
2. Add the action **Run Shell Script**. Replace its text with the full path to `bin/rec` in your clone, for example `~/waraxe-claude-mods/plugins/rec-mode/bin/rec`. Put the path in double quotes if it has a space.
3. Name the shortcut **Toggle REC**.
4. Open the shortcut's details (the ⓘ button), choose **Add Keyboard Shortcut**, and press the key you want, for example ⌃⌥⌘R.
5. Press the key once. If Shortcuts says scripts are not allowed, turn on **Shortcuts > Settings > Advanced > Allow Running Scripts** and press it again.

Each press shows a macOS notification: "REC on: screen masked, mod sounds off" or "REC off: mod sounds are back on". In a terminal, `bin/rec on`, `bin/rec off`, `bin/rec strict` and `bin/rec status` also work.

## Make it yours with `/rec config`

`/rec config` creates `~/.claude/mods-data/rec-mode/config.json`:

```json
{
  "keepNames": ["Your Name"],
  "names": ["A Teammate", "A Client"],
  "privatePaths": ["clients/", "finance/", "my-private-notes.md"],
  "businessTools": [],
  "closedTools": []
}
```

- **keepNames:** your own name (and your brand), shown even while recording.
- **names:** people whose names are always masked. Names in emails and contact fields are picked up on their own.
- **privatePaths:** folders or file names Claude may not open while recording. Any part of a path matches, in any case.
- **businessTools:** extra tool or command names whose results draw as hidden.
- **closedTools:** extra tool names Claude may not call while recording.

Save the file and run `/rec` again.

## Can one mod control another?

Yes, and that is how the silence works. Every call a mod makes to play a clip or speak goes through the other mods' hooks before Claude Code plays it, and a hook may answer the call itself. While REC is on, rec-mode answers every such call from another mod as if the sound had played, so nothing is heard. spoken-alerts is not changed or switched off in your settings: it still believes it spoke, so it neither falls back to the Mac voice nor shows a "voice failed" toast. narrator runs macOS `say` itself instead, so rec-mode also answers any mod's `say` or `afplay` command with a clean exit, and the command never runs. This was checked in real sessions with spoken-alerts and narrator; see [EXPLANATION.md](EXPLANATION.md).

## Cost

None of its own. spoken-alerts keeps doing its work while silenced: one Haiku call after each turn and, with the OpenAI or ElevenLabs voice, the speech download. That is well under a cent per alert. Only the playing is stopped.

## Limits

- It changes what is drawn on screen, what Claude may open and what mods may play, not what is stored. Pattern masking can't catch everything written in plain words, so watch your footage before you publish.
- The chat titles in the desktop app's sidebar can't be masked by a mod.
- Only mods' sounds are silenced. The `claude-cs` terminal's own Stop and Notification hooks (`~/.claude-cs`), macOS notification sounds and the desktop app's own sounds are not.
- A mod that plays sound another way is not silenced either: `say` run through a shell, a player other than `say` and `afplay`, or `$.process.spawn`.
- Masking and the badge in other chats follow within 3 seconds of a switch.
- It keeps its switch and config in `~/.claude/mods-data/rec-mode/`, so a config made with recording-mode's `/rec config` is not read. Copy it there if you made one.
- Both this mod and recording-mode register `/rec`. With both installed, the second one loaded gets `/recording` instead.

## Install

At the prompt of a terminal session:

```text
/plugin install rec-mode --marketplace iWaraxe/waraxe-claude-mods
```

From a shell, and the rest of the install notes, see [INSTRUCTIONS.md](INSTRUCTIONS.md).

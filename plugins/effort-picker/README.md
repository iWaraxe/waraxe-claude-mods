# effort-picker

## What it does

Haiku recommends a reasoning effort for each prompt you send, and you see the choice before Claude starts. It adds one press of Enter to every prompt, so the effort levels stay in front of you and a simple question doesn't run on xhigh or max by accident.

Your message appears in the chat and waits. Two things show up:

- In the desktop app, a row of buttons at the top of the banner above the prompt: `low`, `medium`, `high`, `xhigh`, `max` and `Submit`. Haiku's level is highlighted and yours says `(now)`.
- A short question dialog that names Haiku's level and its reason, with `Submit` selected.

| Your level | Enter or Submit | Clicking a level |
|---|---|---|
| low, medium or high | Applies Haiku's level for this turn | Sends at that level |
| xhigh or max | Keeps your level, and a dim line says what Haiku suggested | Sends at that level |

The chosen level holds for that one turn. Your saved setting never changes, and neither does the model.

## Install

```bash
claude plugin marketplace add iWaraxe/waraxe-claude-mods
claude plugin install effort-picker@waraxe-claude-mods
```

Then open a new chat. Mods load when a chat starts. If you have the rule-based effort-picker from the training marketplace, remove it first (see [INSTRUCTIONS.md](INSTRUCTIONS.md)).

## Use

There is nothing to set up, and there are no commands or settings.

- Press Enter to submit.
- Click a level in the banner to send at that level. The dialog closes by itself.
- The dialog also lists three levels, for the keyboard.
- Dismiss the dialog to send at your own level.

## Cost

One Haiku call per prompt, capped at 40 tokens of reply. It reads your message and the end of Claude's last reply. A higher effort level makes Claude do more work and uses more of your plan. The mod doesn't measure how much.

## Limits

- Haiku judges from a few lines, so it can misjudge. A short "yes, do it" is the hardest case, which is why it also sees the end of the last reply.
- If Haiku fails or takes over 8 seconds, the row and dialog still appear with no recommendation, and Enter keeps your level.
- Only messages you type that start a turn are asked about. Slash commands, plugin prompts and messages typed while Claude works are left alone.
- A `claude -p` run has nobody to ask, so it goes straight through at your level. So does a model that takes no effort level, or an effort set as a number.
- Only the main chat's requests change. Subagents keep their own effort.
- The banner row shows on the desktop app only. VS Code and phones draw no banner, so the dialog alone shows the choice there.
- The terminal hides the banner while a dialog is open, so there the row doesn't show. Use the dialog: it lists Submit and three levels, and you can type `max` under its last option.
- Anthropic's article advises choosing effort as a general preference rather than task by task. This mod chooses per prompt on purpose, to keep you aware of the levels.

## How it works

Enter can't reach a banner row on the desktop app, because a banner never takes the keyboard by itself. A question dialog does. So the dialog takes Enter and the banner holds the five levels. When you click a level, the mod's own `tool.call` hook answers the dialog in its place, which closes it. [EXPLANATION.md](EXPLANATION.md) has the details.

Written by Igor Waraxe. MIT licence, see [LICENSE](LICENSE).

# Waraxe Claude Mods

My Claude Code mods, as a plugin marketplace. Add the repository once, then install each mod as `<plugin>@waraxe-claude-mods`.

## Install

```bash
claude plugin marketplace add iWaraxe/waraxe-claude-mods
claude plugin install status-banner@waraxe-claude-mods
claude plugin install spoken-alerts@waraxe-claude-mods
claude plugin install rec-mode@waraxe-claude-mods
```

Then open a new chat. Mods load when a chat starts. They need Claude Code 2.1.287 or later, with mods turned on for your account.

To update: `claude plugin marketplace update waraxe-claude-mods`, then `claude plugin update <plugin>@waraxe-claude-mods`.

## The mods

| Plugin | Version | What it does |
|---|---|---|
| [`status-banner`](plugins/status-banner/README.md) | 0.3.1 | One status banner above the prompt: plan usage, the session's turn, speed, cost, cache countdown with a Keep warm button and context fill, a goal and next-step summary, and a heads-up after long turns. |
| [`spoken-alerts`](plugins/spoken-alerts/README.md) | 0.3.1 | Speaks two alerts with Mac, OpenAI or ElevenLabs voices: when work ends, the project, the thread and what was done; when Claude asks you something, a chime, the question and the recommended option. |
| [`rec-mode`](plugins/rec-mode/README.md) | 0.1.1 | `/rec` before you record or share your screen: masks keys, personal details and business figures, keeps private files closed, and silences every mod's sounds until `/rec off`. A ○/● REC badge shows the state and switches it. |
| [`effort-picker`](plugins/effort-picker/README.md) | 0.1.0 | Haiku recommends a reasoning effort for each prompt you send. A row of buttons from low to max shows it, and Enter submits: it applies the recommendation on low, medium or high, and keeps xhigh or max. |

Each folder holds a README (commands and settings), `INSTRUCTIONS.md` (install and remove), `EXPLANATION.md` (how it works) and its LICENSE.

## Needs beyond Claude Code

- `spoken-alerts` needs macOS (`say` and `afplay`). The OpenAI and ElevenLabs voices need that provider's API key.
- `rec-mode`'s `bin/rec` script, which switches REC from outside Claude Code, shows a macOS notification.

## Where the code comes from

- `status-banner` uses parts of session-band by JohnnyVizz and usage-meter and where-am-i by Hamza Zafar, all MIT. Its README lists what came from each.
- `rec-mode` is built on [recording-mode](https://github.com/nateherkai/claude-code-mods) by Nate Herk (MIT).
- `spoken-alerts` is built here.

Each folder's LICENSE keeps those copyright notices.

## Safety

Mods run with your permissions and are not sandboxed. Read a mod's code, or run `claude plugin validate plugins/<plugin>`, before you install it.

## License

MIT. See [LICENSE](LICENSE) and the LICENSE in each mod's folder.

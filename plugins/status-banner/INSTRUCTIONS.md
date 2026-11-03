# status-banner: instructions

One status banner above the prompt: plan usage, the session's turn, speed, cost, cache countdown with a Keep warm button and context fill, a goal and next-step summary, and a heads-up after long turns.

## Install

```bash
claude plugin marketplace add iWaraxe/waraxe-claude-mods
claude plugin install status-banner@waraxe-claude-mods
```

Then open a new chat. Mods load when a chat starts.

## Use

The commands, settings and limits are in [README.md](README.md).

## Before you rely on it

- Requires Claude Code 2.1.287 or later, with mods turned on for your account.
- Check it first: `claude plugin validate plugins/status-banner` lists the events it hooks and the calls it makes.
- Mods run with your permissions and are not sandboxed.

## Remove

```bash
claude plugin uninstall status-banner@waraxe-claude-mods
```

Source: Igor Waraxe, MIT, built for this marketplace. Licence: [LICENSE](LICENSE).

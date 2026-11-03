# spoken-alerts: instructions

Speaks two alerts with Mac, OpenAI or ElevenLabs voices: when work ends, the project, the thread and what was done; when Claude asks you something, a chime, the question and the recommended option.

## Install

```bash
claude plugin marketplace add iWaraxe/waraxe-claude-mods
claude plugin install spoken-alerts@waraxe-claude-mods
```

Then open a new chat. Mods load when a chat starts.

## Use

What it says, when, and its limits are in [README.md](README.md).

## Before you rely on it

- Requires Claude Code 2.1.287 or later, with mods turned on for your account.
- Check it first: `claude plugin validate plugins/spoken-alerts` lists the events it hooks and the calls it makes.
- Mods run with your permissions and are not sandboxed.

## Remove

```bash
claude plugin uninstall spoken-alerts@waraxe-claude-mods
```

Source: Igor Waraxe, MIT, built for this marketplace. Licence: [LICENSE](LICENSE).

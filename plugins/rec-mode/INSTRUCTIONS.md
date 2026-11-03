# rec-mode: instructions

/rec before you record or share your screen: masks keys, personal details and business figures, keeps private files closed, and silences every mod's sounds (spoken-alerts, narrator) until /rec off. A ○/● REC badge shows the state and switches it.

## Install

It replaces recording-mode, so remove that one first if you have it:

```bash
claude plugin uninstall recording-mode@waraxe-claude-mods
claude plugin marketplace add iWaraxe/waraxe-claude-mods
claude plugin install rec-mode@waraxe-claude-mods
```

Then open a new chat. Mods load when a chat starts. For the Mac hotkey, follow "Set up the Mac hotkey" in the README.

## Use

The commands, the badge, the hotkey, settings and limits are in [README.md](README.md).

## Before you rely on it

- Requires Claude Code 2.1.287 or later, with mods turned on for your account.
- Check it first: `claude plugin validate plugins/rec-mode` lists the events it hooks and the calls it makes.
- Mods run with your permissions and are not sandboxed.

## Remove

```bash
claude plugin uninstall rec-mode@waraxe-claude-mods
```

Source: Igor Waraxe, MIT, built for this marketplace on Nate Herk's recording-mode (MIT, https://github.com/nateherkai/claude-code-mods). Licence: [LICENSE](LICENSE).

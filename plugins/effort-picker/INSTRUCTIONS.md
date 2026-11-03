# effort-picker: instructions

Haiku recommends a reasoning effort for each prompt you send. A row of buttons from low to max shows it, and Enter submits: it applies the recommendation on low, medium or high, and keeps xhigh or max.

## Install

It replaces the rule-based effort-picker, so remove that one first if you have it. The line below is for the one in the training marketplace `claude-mods-demo`; `claude plugin list` shows the full name of yours.

```bash
claude plugin uninstall effort-picker@claude-mods-demo
claude plugin marketplace add iWaraxe/waraxe-claude-mods
claude plugin install effort-picker@waraxe-claude-mods
```

Then open a new chat. Mods load when a chat starts.

## Use

What it shows and what each press does are in [README.md](README.md).

## Before you rely on it

- Requires Claude Code 2.1.287 or later, with mods turned on for your account.
- Check it first: `claude plugin validate plugins/effort-picker` lists the events it hooks and the calls it makes.
- Mods run with your permissions and are not sandboxed.

## Remove

```bash
claude plugin uninstall effort-picker@waraxe-claude-mods
```

Source: Igor Waraxe, MIT. Licence: [LICENSE](LICENSE).

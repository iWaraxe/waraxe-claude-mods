# Changelog

## 2026-11-03, rec-mode install steps

- `rec-mode/INSTRUCTIONS.md`: the line that removes recording-mode first now names `recording-mode@claude-mods-demo`, the training marketplace where recording-mode is. It named `@waraxe-claude-mods`, which never had recording-mode after the move.
- `rec-mode/README.md`: the hotkey's example path is `~/waraxe-claude-mods/plugins/rec-mode/bin/rec`, with a note to quote a path that has a space. It pointed to the training repository's folder, which no longer has rec-mode.
- No code changed. The training repository's lessons 0045–0047 link to this commit.

## 2026-11-03

- New repository and marketplace `waraxe-claude-mods` (1.0.0), for `iWaraxe/waraxe-claude-mods` on GitHub.
- Moved three mods here from the training repository `coherentsolutionstrainingcenter/claude-mods-demo`, unchanged in code: `status-banner` 0.3.1, `spoken-alerts` 0.3.0 and `rec-mode` 0.1.1. The training repository no longer ships them or their lessons (0045–0047).
- Each mod's install lines now name `iWaraxe/waraxe-claude-mods`. `EXPLANATION.md` no longer links to a lesson.
- `status-banner/FIELDS.md` is the field list agreed before the banner was written, moved from the training repository's `docs/COMBINED-BANNER-FIELDS.md`.
- `rec-mode`'s README and EXPLANATION link to recording-mode's own repository instead of a sibling folder.

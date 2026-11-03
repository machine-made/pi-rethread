# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed
- The handoff is wait, pack, move, unpack: `/rethread` waits for a busy agent to settle, then one `pack` message tidies up, writes the letter and the entry; `land` and `write` are gone.
- The tool is `rethread_pack`, with the parameters `letter` and `entry` (`rethread_save`, `next_message` and `ledger` are gone).
- Flags: `--now` is now `--summary`, `--ledger-file` is now `--rethread-ledger`, and the internal `--switch` is now `--move`.
- Prompt files: `write.md` is now `pack.md`, `kickoff.md` is now `unpack.md`, and `land.md` is gone.
- The five-part letter shape is defined once in `rethread.ts` and filled into `pack.md` and `summary.md` as `{{letter_shape}}`.

### Removed
- `--review` (edit the ledger entry before moving), with its variable, argument field, editor block, usage text and README lines.
- The `session_start` reset, which only repeated the factory's initial values.
- `prompts/land.md`: its tidy-up instructions are now the first part of `pack.md`.

## [0.1.1] - 2026-10-28

### Changed
- The package name in the repository is `@machine-made/pi-rethread`, the name 0.1.0 is published under on npm.

## [0.1.0] - 2026-10-28

### Added
- `/rethread [goal]`: the agent lands its step, writes a letter to the next session and a ledger entry (`rethread_save` tool), then a new session opens with the letter and asks for a three-line readback.
- `/rethread --now` (side model call writes the handoff), `--review` (edit before moving), `--cancel`.
- `/ledger` shows the ledger file and its entry count.
- Automatic rethread at `--rethread-auto-percent` (default 70) and instead of Pi's automatic compaction; once per session, with a loop guard.
- The four prompts are Markdown templates; a project can override each one in `.pi/rethread/`.

### Fixed (before the first release)
- A reply that went past the whole context window let Pi compact the old session in the middle of the handoff, so the agent wrote its letter from a lossy summary. Only Pi's recovery of a rejected request (which must retry) may compact now.
- The integration tests read `~/.agents/skills` and `PI_*` variables from the real environment, so their result depended on the machine. Each Pi now runs with an empty home.

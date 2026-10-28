# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

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

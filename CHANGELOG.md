# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-10-27

### Added
- `/rethread [goal]`: the agent lands its step, writes a letter to the next session and a ledger entry (`rethread_save` tool), then a new session opens with the letter and asks for a three-line readback.
- `/rethread --now` (side model call writes the handoff), `--review` (edit before moving), `--cancel`.
- `/ledger` shows the ledger file and its entry count.
- Automatic rethread at `--rethread-auto-percent` (default 70) and instead of Pi's automatic compaction; once per session, with a loop guard.
- The four prompts are Markdown templates; a project can override each one in `.pi/rethread/`.

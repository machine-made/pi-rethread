[![CI](https://github.com/machine-made/pi-rethread/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/machine-made/pi-rethread/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@machine-made/pi-rethread.svg)](https://www.npmjs.com/package/@machine-made/pi-rethread)
[![Node](https://img.shields.io/node/v/@machine-made/pi-rethread.svg)](https://www.npmjs.com/package/@machine-made/pi-rethread)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

`pi-rethread` is an extension for [pi](https://github.com/earendil-works/pi): when a session gets long, the agent finishes its step, writes a **letter** to the next session and a **ledger** entry, and the work continues in a **fresh session**. No lossy compaction.

```text
pi install npm:@machine-made/pi-rethread
```

Tested with Pi 1.4.0.

## Commands

```text
/rethread [goal]     pack, move, continue in a new session
/rethread --summary  skip the agent (it is stuck): a side model call writes the handoff
/rethread --cancel   stop a rethread in progress
/ledger              show the ledger file and its number of entries
```

## What happens

`/rethread` moves through wait, pack, move and unpack:

1. **Wait**, only if the agent is still working. `/rethread` tells the user to let the agent finish
   and sends nothing until the run settles, so the handoff is written from a stopped agent. A second
   `/rethread` during the wait is refused. An idle agent skips this step.
2. **Pack.** The agent tidies up and stops at a safe point: it finishes a step that needs only a few
   more actions, starts nothing new, leaves no half-edited file, and runs the quick check (tests,
   build) once. Then, in one call to the `rethread_pack` tool, it writes a letter to the agent of the
   next session in a fixed shape: *Where we are*, *Do first*, *Watch out*, *Don't redo* (dead ends,
   so they are not tried again) and *Trust* (verified vs assumed). In the same call it writes the
   durable facts: Goal, Done, Decisions, Files, Commands, Open problems, Next steps, opening with a
   short verified / assumed / still broken line. The letter is intent for the next hop; the entry is
   what stays true across many hops.
3. **Move.** The entry is appended to `.pi/ledger.md` and a new session opens, linked to the old one
   as its parent.
4. **Unpack.** The new session's first message carries the letter and the entry and asks for a
   three-line readback: the goal, the first action, the main risk. A misunderstanding costs one short
   reply instead of a whole run.

The `rethread_pack` tool is shown to the model only during pack.

There are three messages: `pack` and `unpack` go to the agents, and `move` is the internal command
that switches sessions. The summary is a system prompt for the side model, not a message to the
agent. If the agent does not call the tool, that side model writes the letter and the entry from the
transcript instead, and the move still happens.

## Automatic

After a run, if context use is at or above `--rethread-auto-percent` (default 70), `/rethread`
starts by itself. When Pi would auto-compact first, the compaction is cancelled and a rethread
runs instead. This covers Pi's threshold and a reply that silently went past the window. No
automatic compaction touches the old session while the agent writes its handoff.

Left alone: manual `/compact`, and Pi's recovery when the provider rejects a request as too long.
That recovery compacts and retries the failed turn; without it the turn cannot run. The rethread
then continues, and the agent writes its letter from the compacted session.

It fires once per session. If a new session is already over the limit right after the handoff
(a low limit, a long ledger), the automatic rethread turns itself off for that session and says so,
so it never loops.

## Flags

| Flag | Default | Meaning |
|---|---|---|
| `--rethread-auto-percent <n>` | `70` | Context % that starts `/rethread`; `0` turns the automatic rethread off |
| `--rethread-ledger <path>` | `.pi/ledger.md` | Ledger file, relative to the working directory |

## Your own prompts

The messages are Markdown templates in [`prompts/`](prompts). Put a file with the same name in
`.pi/rethread/` of a project to replace one there:

| File | Sent to | Placeholders |
|---|---|---|
| `pack.md` | the old agent | `{{tool}}` `{{headings}}` `{{goal_line}}` `{{previous}}` `{{letter_shape}}` |
| `unpack.md` | the new agent | `{{ledger_path}}` `{{letter}}` `{{goal_line}}` `{{status}}` `{{ledger}}` |
| `summary.md` | the side model (`--summary`, fallback) | `{{headings}}` `{{letter_shape}}` |

The letter shape is defined once, in `LETTER_SHAPE` in `rethread.ts`, and filled into
`{{letter_shape}}` in both `pack.md` and `summary.md`.

A custom `unpack.md` must keep a `<rethread-ledger>` tag: it is how the new session knows it was
started by a rethread (for the loop guard).

## The ledger

`.pi/ledger.md` is plain Markdown, newest entry last. Each entry records the old session file, the
status (`landed`, `partial`, `blocked`), who wrote it (the agent or a summary), the goal, the ledger
sections and the letter. The file is written atomically. Commit it, or add it to `.gitignore`.

## Limits

- A `/rethread --cancel` typed in the instant between two steps is queued behind the next step;
  type it again.
- The new session uses the same model and tools as the old one.

## Development

```text
bun install
bun run check
bun run test
```

The integration test runs real Pi in RPC mode with a scripted fake model, so it needs no API key.

## Licence

Apache-2.0

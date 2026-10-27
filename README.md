# pi-rethread

Extension for [pi](https://github.com/earendil-works/pi): when a session gets long, the agent finishes its step, writes a **letter** to the next session and a **ledger** entry, and the work continues in a **fresh session**. No lossy compaction.

```text
pi install npm:pi-rethread
```

Tested with Pi 1.4.0.

## Commands

```text
/rethread [goal]     finish, hand off, continue in a new session
/rethread --now      skip the agent (it is stuck): a side model call writes the handoff
/rethread --review   edit the ledger entry before moving (interactive only)
/rethread --cancel   stop a rethread in progress
/ledger              show the ledger file and its number of entries
```

## What happens

`/rethread` runs four prepared messages, each doing one job:

1. **Land.** The running agent finishes the step it is on and stops at a safe point: no half-edited
   file, no new work, the quick check (tests, build) run once. It replies in three lines: what is
   *verified*, what is only *assumed*, what is still broken.
2. **Letter.** The agent writes to the agent of the next session, in a fixed shape:
   *Where we are*, *Do first*, *Watch out*, *Don't redo* (dead ends, so they are not tried again)
   and *Trust* (verified vs assumed). The letter comes first: writing to a colleague forces priorities.
3. **Ledger.** In the same tool call, after the letter, the agent writes the durable facts:
   Goal, Done, Decisions, Files, Commands, Open problems, Next steps. The letter is intent for the
   next hop; the ledger is what stays true across many hops. It is appended to `.pi/ledger.md`.
4. **Readback.** A new session opens (linked to the old one as its parent) and receives the letter
   and the ledger entry. Its first reply is three lines: the goal, the first action, the main risk.
   A misunderstanding costs one short reply instead of a whole run.

The `rethread_save` tool is shown to the model only during step 2.

If the agent does not call the tool, a side model call writes the letter and the ledger from the
transcript instead, and the move still happens.

## Automatic

After a run, if context use is at or above `--rethread-auto-percent` (default 70), `/rethread`
starts by itself. When Pi would auto-compact first, the compaction is cancelled and a rethread
runs instead. Manual `/compact` and overflow recovery are left alone.

It fires once per session. If a new session is already over the limit right after the handoff
(a low limit, a long ledger), the automatic rethread turns itself off for that session and says so,
so it never loops.

## Flags

| Flag | Default | Meaning |
|---|---|---|
| `--rethread-auto-percent <n>` | `70` | Context % that starts `/rethread`; `0` turns the automatic rethread off |
| `--ledger-file <path>` | `.pi/ledger.md` | Ledger file, relative to the working directory |

## Your own prompts

The four messages are Markdown templates in [`prompts/`](prompts). Put a file with the same name in
`.pi/rethread/` of a project to replace one there:

| File | Sent to | Placeholders |
|---|---|---|
| `land.md` | the old agent, step 1 | none |
| `write.md` | the old agent, step 2 | `{{tool}}` `{{headings}}` `{{goal_line}}` `{{previous}}` |
| `kickoff.md` | the new agent, step 4 | `{{ledger_path}}` `{{letter}}` `{{goal_line}}` `{{status}}` `{{ledger}}` |
| `summary.md` | the side model (`--now`, fallback) | `{{headings}}` |

A custom `kickoff.md` must keep a `<rethread-ledger>` tag: it is how the new session knows it was
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

[rethread 2/2: write] Now write the handoff with one call to the `{{tool}}` tool. Fill the fields in this order.

**`next_message`**: a letter from you to the agent of the next session. Write it to them ("You..."), short, in this shape:
- **Where we are**: two sentences.
- **Do first**: one concrete action.
- **Watch out**: traps, flaky tests, things that look right but are not.
- **Don't redo**: approaches already tried that failed, and why.
- **Trust**: what is verified and what is only assumed.

**`ledger`**: durable facts that stay true across many sessions. Self-contained: the next agent has no access to this conversation. Use exactly these headings, in this order, and write "none" under a heading with nothing to say:
{{headings}}
Carry over what is still true from the previous entry; drop what is finished or obsolete. Be specific: exact paths, commands, numbers, error messages.

**`status`**: `landed` (clean stopping point), `partial` (work in progress, described in the ledger) or `blocked` (cannot continue without the user).

{{goal_line}}

Previous ledger entry:
{{previous}}

After the tool call, stop.

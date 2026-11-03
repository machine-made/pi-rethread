[rethread: pack] This session is about to end and a fresh session will continue the work.

Tidy up now, then call the tool in this same turn:
- Finish the step you are on if it needs only a few more actions. Do not start anything new.
- Leave no half-edited file. If a change cannot be finished, revert it or leave a clear `TODO(rethread)` comment.
- If the project has a quick check (tests, build, lint), run it once.
- Do not stop to report back first: the verified / assumed / still broken line goes in the `entry` field below.

Write the handoff with one call to the `{{tool}}` tool. Fill the fields in this order.

**`letter`**: a letter from you to the agent of the next session. Write it to them ("You..."), short, in this shape:
{{letter_shape}}

**`entry`**: start with one short line naming what is **Verified**, what is **Assumed** and what is **Still broken**, then the durable facts that stay true across many sessions. Self-contained: the next agent has no access to this conversation. Use exactly these headings, in this order, and write "none" under a heading with nothing to say:
{{headings}}
Carry over what is still true from the previous entry; drop what is finished or obsolete. Be specific: exact paths, commands, numbers, error messages.

**`status`**: `landed` (clean stopping point), `partial` (work in progress, described in the ledger) or `blocked` (cannot continue without the user).

{{goal_line}}

Previous ledger entry:
{{previous}}

After the tool call, stop.
# Security

pi-rethread has not had a security review yet.

What it does: it reads and writes one Markdown file (`.pi/ledger.md`, or the path given by
`--ledger-file`), reads prompt templates from the package and from `.pi/rethread/` in the working
directory, sends prompts to the session's own model, and opens a new Pi session. It makes no network
call of its own and spawns no process.

Things to know:
- The ledger and the letter are written by the model and sent to the next session as a user message.
  Treat them like any other model output: review the ledger if the session handled untrusted input.
- Project templates in `.pi/rethread/` change what is sent to the model, and they are read from
  the working directory whoever wrote them. Check that folder in a repository you did not write.

Report issues at https://github.com/machine-made/pi-rethread/issues

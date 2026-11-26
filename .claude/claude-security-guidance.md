# Security review scope for Hermes Kanban

Hermes Kanban is a herdr mod that runs as the logged-in user on that user's own Mac. It talks to the Hermes agent machines of that user over the user's own SSH connection and can change tasks there. Review findings against this threat model and do not report what it puts out of scope.

## Threat model

- One user per Mac. The Mac, its file system and the user's home folder are trusted.
- Hermes machines are reached over the user's own SSH connection (`hc exec`). The connection and the remote shell are trusted; the machine is not an attacker.
- The attacker controls **content**: task titles, task bodies, comments, agent names, event text and any API answer that comes from a Hermes instance.

## Protection goals (report violations)

- **The access key never appears in argv, never reaches the Mac, and never shows up in logs, toasts, shared values or output.** It is read on the Hermes machine and handed to `curl` through a file or stdin there.
- **An action goes only to the machine the task came from**, whatever pane has focus when the click happens.
- **No gateway restart without a click** of the user.
- Command or argument injection: a title, comment or body with quotes, `$()`, backticks or newlines must reach Hermes unchanged and must never run on the machine.
- A task id or agent name with `/`, `?`, `&` or `..` must never reach a URL path or query unchecked.
- Content from an API answer must not execute or load remote resources when shown.

## Out of scope (do not report)

- Race conditions and TOCTOU that need a second local user or a hostile local process.
- Timing attacks and side channels.
- Other local users or processes on the same Mac, and a compromised local account.
- Denial of service by very large boards; treat these as performance issues.
- Hardening that only helps against an attacker who already runs code as the user.

When in doubt, a finding is in scope only if untrusted board content alone, shown to the user, can trigger it.

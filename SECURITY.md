# Security policy

pi-secure protects a narrow boundary: secret values stay out of its own model-facing tool results and session entries. It is not an OS sandbox, encrypted vault, or defense against malicious agents, commands, extensions, or local observers.

## Report a vulnerability

Please use [GitHub private vulnerability reporting](https://github.com/moejay/pi-secure/security/advisories/new) when enabled. If unavailable, open an issue asking for a private contact channel **without exploit details or credentials**. Never submit real secrets in issues, logs, screenshots, or reproductions.

Only the latest release receives fixes. Use short-lived, least-privilege credentials and revoke anything you suspect was exposed.

## Important limits

- A malicious or prompt-injected model can still obtain or exfiltrate secrets through its tools. pi-secure does not prevent prompt injection or enforce secret isolation; local reveal/copy confirmations do not secure other tool paths.
- Shell commands can transmit or persist secrets; approve only trusted tasks.
- Exact-value output redaction does not cover transformed, encoded, partial, or already-logged values, or other tools' output.
- Terminal recording, input logging, clipboard managers/sync, process inspection, crash dumps, and other extensions are outside the boundary. During entry, the asterisk count exposes the current input length locally; the inspection dialog uses a fixed mask until explicitly revealed.
- `/secret show NAME` and the `/secret list` browser are local UI paths, not model calls. Reveal/copy still require confirmation. Forgetting even one value cancels active secure operations and queued dialogs, but does not revoke credentials or erase external copies.
- Redaction checks all stored values, not only injected secrets. Large or numerous values can exceed redaction limits; processing errors discard output rather than returning it unredacted. The underlying command may already have completed, so check its effects before retrying.
- Clipboard contents are not automatically cleared: overwriting later could destroy something else you copied. Clear your clipboard and history yourself.
- Memory is process-local; JavaScript does not guarantee zeroization.
- Names, commands, reasons, statuses, and redacted execution output are public to the agent and normal session logs.

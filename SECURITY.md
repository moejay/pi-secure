# Security policy

pi-secure protects a narrow boundary: secret values stay out of its own model-facing tool results and session entries. It is not an OS sandbox, encrypted vault, or defense against malicious agents, commands, extensions, or local observers.

## Report a vulnerability

Please use [GitHub private vulnerability reporting](https://github.com/moejay/pi-secure/security/advisories/new) when enabled. If unavailable, open an issue asking for a private contact channel **without exploit details or credentials**. Never submit real secrets in issues, logs, screenshots, or reproductions.

Only the latest release receives fixes. Use short-lived, least-privilege credentials and revoke anything you suspect was exposed.

## Important limits

- Shell commands can transmit or persist secrets; approve only trusted tasks.
- Exact-value output redaction does not cover transformed, encoded, partial, or already-logged values, or other tools' output.
- Terminal recording, input logging, clipboard managers/sync, process inspection, crash dumps, and other extensions are outside the boundary.
- Clipboard contents are not automatically cleared: overwriting later could destroy something else you copied. Clear your clipboard and history yourself.
- Memory is process-local; JavaScript does not guarantee zeroization.
- Names, commands, reasons, statuses, and redacted execution output are public to the agent and normal session logs.

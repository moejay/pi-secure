# pi-secure demo — accessible transcript

**Title:** Secrets stay out of the conversation.

**Duration:** 26 seconds. Silent video, with burned-in text and companion [WebVTT captions](demo.vtt). [Preview](preview.png) · [Video](demo.mp4)

## What is real, and what is scripted?

This is a real, isolated, offline Pi terminal session with scripted inputs and no model calls. It uses the actual pi-secure masked request component, actual `request_secret` and `secure_exec` implementations, the exported local secret dialog, and the actual `/secret clear` handler. A local shell subprocess really runs, and its exact-value redaction is checked by the driver. The messages summarizing calls/results are scripted narration, not a model conversation or a model-issued tool-call trace.

The only value is **`demo-only-not-a-real-credential`**. Copy confirmation uses the real dialog, but its clipboard callback is replaced with an in-memory success stub. **Clipboard copy is simulated; the native clipboard is never read or modified.** The local dialog is presented non-overlay for legibility. Headings, window chrome, subtitles, and disclosures are editorial framing around actual captured terminal cells; the warm palette is a custom Pi theme.

## Timeline

| Time | Visible action and text |
| --- | --- |
| 00:00–00:03.4 | `request_secret` asks for `DEMO_TOKEN`. Reason: “Local demo only. Enter a fake credential, not a real token.” The scripted value appears only as `********`. The form says it is held in memory and commands may use or save it: not a sandbox. |
| 00:03.4–00:04.4 | The actual request result reports only `{"name":"DEMO_TOKEN","available":true}`. |
| 00:04.4–00:08.5 | `secure_exec` runs `printf 'Token: %s\n' "$DEMO_TOKEN"` with the named value injected into the environment. It exits successfully. The returned output reads `Token: [REDACTED]`, not the fake value. |
| 00:08.5–00:10.2 | The local dialog opens: `Secret: DEMO_TOKEN`, `******** (masked)`. Controls read: “R: reveal/hide • C: copy • Enter/Esc/Ctrl+C: close”. It warns that it auto-closes after 30 seconds and hiding does not erase recordings. |
| 00:10.2–00:12 | Scripted C opens the actual copy confirmation: other apps, clipboard history, or sync may retain the value. Y confirms. The video's caption explicitly says the clipboard is simulated. |
| 00:12–00:14.3 | The real component displays “Copied. Clipboard is not automatically cleared.” The secret remains masked. In this recording that success comes from the simulated callback, not the native clipboard. |
| 00:14.3–00:16.2 | Scripted R opens the real reveal confirmation, warning that terminal recordings and scrollback may retain the value. Y confirms. |
| 00:16.2–00:18.7 | The fake value `demo-only-not-a-real-credential` is briefly visible in the local dialog, then R masks it again. |
| 00:18.7–00:23.1 | The dialog closes. The actual `/secret clear` handler runs: “Secrets forgotten.” A later real `secure_exec` call using `DEMO_TOKEN` fails: “A requested secret is unavailable. Use request_secret first.” |
| 00:23.1–00:26 | The final terminal state is held for reading. Caption: “Transcript hygiene, not a security boundary.” |

All frames disclose: **Real Pi UI · scripted inputs · no model calls · fake credential only · clipboard copy simulated.**

The persistent boundary statement reads: **Transcript hygiene, not a sandbox. Not protection from a malicious or prompt-injected model.**

## Important limits

This demonstrates local UI and exact known-value output redaction, not remote authentication, model reasoning, native clipboard integration, or a model-issued end-to-end tool round trip. Commands retain normal operating-system permissions and can write or transmit values. Encoded or transformed values are not covered by exact-value redaction. Hiding or clearing does not erase recordings, scrollback, files, or clipboard history. No real credential or personal filesystem path appears in the final media.

See [the development-only capture instructions](https://github.com/moejay/pi-secure/blob/main/scripts/demo/README.md) for the reproducible process. Raw terminal recordings and intermediate frames are temporary only.

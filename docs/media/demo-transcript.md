# Check a private build

**Video:** 24 seconds, silent, 1280×800. Captions: [demo.vtt](demo.vtt).

| Time | On screen |
| --- | --- |
| 0–4 s | Pi requests `BUILD_TOKEN` for a private localhost build API. The scripted entry is masked. |
| 4–5 s | The result reports only the token name and availability. |
| 5–10 s | Actual `secure_exec` runs `curl` against the ephemeral localhost URL, using `Authorization: Bearer $BUILD_TOKEN`. The authenticated fixture returns build 184 on main: passed, 12 / 12 checks. |
| 10–14 s | The actual local secret dialog starts masked. R opens a reveal confirmation; Y confirms. |
| 14–18 s | `example-local-api-token` is revealed locally, then hidden. Enter closes the dialog. C is visible but unused. |
| 18–21.5 s | The actual `/secret clear` handler clears the vault. A subsequent execution verifies `BUILD_TOKEN` is unavailable. |
| 21.5–24 s | Closing caption: “Transcript hygiene, not a sandbox.” |

## Recording notes

This is a scripted example using a real offline Pi terminal UI and the extension's real `request_secret`, `secure_exec`, `show_secret`, and clear implementations. There are no model calls or claims of autonomous agent reasoning. Request/result labels are editorial narration rendered through Pi; they are not fabricated assistant messages or model-issued tool-call transcript records.

The driver actually starts an ephemeral HTTP fixture bound only to `127.0.0.1`. It first verifies an unauthenticated request receives HTTP 401, then verifies that the curl request authenticated with the injected environment token receives HTTP 200 and the expected JSON. Build 184 is fixture data, not a GitHub/cloud response or a claim about a real external build. Only the obviously synthetic `example-local-api-token` is used. No external service, real credential, or credential store is accessed.

No copy action is demonstrated, no copy-success callback is simulated, and no native clipboard read/write occurs. The displayed C shortcut is simply part of the real local dialog. The synthetic value appears only during local reveal; the request result and build status do not contain it. This sequence does not deliberately echo a token or demonstrate output redaction.

The title, window chrome, captions, and 24-second edit are editorial framing. The terminal cells come from an actual PTY capture; the PNG uses the masked local-inspection state. Capture isolation, reproduction commands, and assertions are documented in [scripts/demo/README.md](../../scripts/demo/README.md). Raw recordings and verification remain temporary, outside the repository.

## Security boundary

Transcript hygiene is not a sandbox or a defense against a malicious/prompt-injected model. Commands retain normal OS permissions and can transmit or transform secrets. Exact-value output redaction cannot cover every encoding or misuse. Local reveal may persist in terminal recordings/scrollback; clearing the vault does not erase recordings or files.

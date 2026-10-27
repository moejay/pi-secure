# Keep tokens local

**Video:** 32 seconds, silent, 1280×800. Captions: [demo.vtt](demo.vtt).

| Time | On screen |
| --- | --- |
| 0–4.5 s | Real centered `request_secret` overlay for `BUILD_TOKEN`. Scripted input grows from 8 to 14 to 18 to 23 asterisks, never plaintext. Enter submits. |
| 4.5–5.4 s | Request result reports only name and availability. |
| 5.4–8.6 s | Actual `secure_exec` runs curl against an authenticated localhost fixture with `Authorization: Bearer $BUILD_TOKEN`. Build 184 on main passed, 12 / 12 checks. |
| 8.6–10.3 s | Actual `/secret show BUILD_TOKEN` opens the prominent local dialog, initially masked. |
| 10.3–12 s | R opens the reveal confirmation; Y confirms. |
| 12–14.8 s | The synthetic token is briefly visible locally. R hides it; Enter closes. C is visible but never used. |
| 14.8–19.7 s | Actual `/secret list` browser shows names only. Selection scrolls through fifteen entries, past the twelve-row viewport, to `DEMO_TOKEN_14` at 15/15. |
| 19.7–22 s | Enter opens the selected secret's masked local dialog. Enter closes it and returns to the browser. |
| 22–25.7 s | D requests forgetting `DEMO_TOKEN_14`. The real Y/N confirmation is visible; Y confirms. |
| 25.7–28 s | Refreshed browser shows fourteen entries, with `DEMO_TOKEN_13` selected at 14/14. The forgotten name is gone. Esc closes. |
| 28–30.5 s | Actual `/secret clear` forgets all remaining names. A subsequent execution verifies `BUILD_TOKEN` is unavailable. |
| 30.5–32 s | Closing caption: “Transcript hygiene, not a sandbox. Clearing cannot erase recordings.” |

## Recording notes

This scripted example uses a real offline Pi terminal UI and the extension's real request, execution, local-show command, browser, capture, and clear implementations. No model calls or autonomous agent reasoning are involved. Request/result labels are editorial narration rendered through Pi, not fabricated assistant messages or model-issued tool-call records. The real extension's centered overlay settings and component rendering are preserved.

An ephemeral HTTP fixture binds only to `127.0.0.1`. The driver verifies that an unauthenticated request receives HTTP 401, then verifies curl's authenticated HTTP 200 response, exact expected JSON, exit 0, and one authenticated request. Build 184 is fixture data, not an external build-service response. Only synthetic credentials are used: `example-local-api-token` for `BUILD_TOKEN` and `synthetic-browser-fixture` for fourteen browser entries. The latter are seeded through actual `capture_secret` calls before opening the browser. No external service or credential store is accessed.

No copy action is demonstrated, no copy-success callback is simulated, and no native clipboard read/write occurs. The displayed C shortcut belongs to the real dialog. The synthetic build token appears only during local reveal; request results and build output do not contain it. This sequence does not deliberately echo a token or demonstrate output redaction.

Title, window chrome, captions, and the final hold to 32 seconds are editorial framing. Terminal cells come from an actual 112×25 PTY capture, resampled at 10 fps and encoded at 30 fps. The PNG uses the masked `/secret show BUILD_TOKEN` state. Captions mirror the burned-in text. Reproduction and assertions are documented in [scripts/demo/README.md](../../scripts/demo/README.md). Raw recordings, frame snapshots, and successful `verification.json` remain temporary, outside the repository.

Verification checks both component render output and captured terminal cells: changing mask lengths, request border, no request/browser plaintext, command-show masking, reveal confirmation, scrolling/selection to 15/15, selected-name show, forget confirmation, refreshed 14/14 browser without the removed name, and unavailable names after browser/all-vault clear.

## Security boundary

Process/configuration isolation is not an OS network sandbox. Transcript hygiene is not protection against a malicious/prompt-injected model. Commands retain normal OS permissions and can transmit or transform secrets. Exact-value output redaction cannot cover every encoding or misuse. Local reveal may persist in terminal recordings/scrollback; clearing the vault does not erase recordings or files.

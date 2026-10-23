# Rebuild the gallery media

These development-only files are outside the package's `files` allowlist. They generate `docs/media/preview.png`, `demo.mp4`, and `demo.vtt`; the transcript describes the same sequence. No raw terminal recordings or frame snapshots are committed.

## Prerequisites

- macOS with Menlo, Georgia, and Arial system fonts (the renderer names their standard paths).
- Node.js supported by this project, installed project dependencies (`npm ci --ignore-scripts`), and `pi` on `PATH`.
- Python 3 with pip; `ffmpeg` at `/opt/homebrew/bin/ffmpeg` and `ffprobe` for validation.
- `rg` and `fd` on the isolated process's `PATH` avoid Pi's offline missing-helper notices.

Install Python dependencies in a temporary directory only; no repository dependency changes:

```sh
TOOLS="$(mktemp -d /tmp/pi-secure-media-tools.XXXXXX)"
python3 -m pip install --target "$TOOLS" pyte Pillow
export PYTHONPATH="$TOOLS${PYTHONPATH:+:$PYTHONPATH}"

# From the repository root. Takes about 26 seconds.
python3 scripts/demo/capture.py
# Its first output line is the temporary capture directory; use that path:
python3 scripts/demo/render.py /path/printed/by/capture/frames.json

/opt/homebrew/bin/ffprobe -v error \
  -show_entries stream=codec_name,width,height,pix_fmt \
  -show_entries format=duration,size -of json docs/media/demo.mp4
```

The capture uses a new temporary working directory, HOME, and Pi agent directory; an explicit environment allowlist; no persisted session; offline mode; no automatic extensions, skills, templates, context files, themes, MCP, or built-in tools. It explicitly loads only `driver.ts` and `secure-demo.json`. It does **not** inherit credential environment variables, access the user's Pi credential store, or call a model. A CLI API-key override is the same deliberately fake string as the demo value, solely to suppress Pi's missing-model startup warning; it is never used for a request.

The capture command launches Pi on a real 112×25 PTY and types `/demo`. Pi renders the actual extension components. The driver imports the root extension, captures its registered tool definitions through a Proxy, and invokes their actual `execute` implementations using the command's local UI context. It feeds scripted input into the real request component. `secure_exec` runs a real local shell command and the driver asserts that its output is exactly redacted. The actual `/secret clear` command handler clears the vault; an actual later execution verifies unavailability.

The locally displayed secret dialog is the exported `createSecretDialog`, presented through Pi's `ctx.ui.custom` (non-overlay for media legibility). Its copy callback is an injected in-memory success stub that checks the fake value. **Clipboard copying is simulated: no native clipboard utility runs, and the system clipboard is untouched.** Reveal/copy confirmation screens and masking are real component behavior. This does not demonstrate the native clipboard backend, model reasoning, remote authentication, or a full model-issued tool-call round trip. Narration/tool-result messages are editorial messages sent by the driver, not model messages.

The renderer uses pyte to interpret the captured ANSI terminal output, then paints those terminal cells with Pillow. The headline, window chrome, subtitles, and disclosures are editorial framing, not a reproduction of Pi controls. A warm custom Pi theme improves contrast. The 23-second capture is resampled at 10 fps, held at its final state to 26 seconds, and encoded at 30 fps as silent H.264/yuv420p with faststart. VTT captions and burned-in captions carry the same sequence. The preview takes the actual masked-dialog state at approximately 9.1 seconds. Temporary capture files and rendered frames stay under the system temporary directory.

## Safety boundary

Only `demo-only-not-a-real-credential` is entered or revealed. Do not substitute a real credential: terminal recordings and frame snapshots deliberately retain revealed values. The final media visibly discloses scripted inputs, no model calls, fake-only data, and simulated copying.

**Transcript hygiene, not a sandbox. Not protection from a malicious or prompt-injected model.** Commands still have ordinary OS permissions; exact-value redaction does not cover encoded or transformed values, and clearing the vault does not erase recordings, clipboard history, or files.

#!/usr/bin/env python3
"""Capture real Pi ANSI output in a PTY; never inherits credentials.
Requires pyte + Pillow in the Python environment. Outputs raw capture to /tmp.
Run from the repository root: python3 scripts/demo/capture.py
"""
import os, pty, subprocess, select, time, fcntl, termios, struct, json, tempfile, codecs
from pathlib import Path
import pyte
ROOT = Path(__file__).resolve().parents[2]
WORK = Path(tempfile.mkdtemp(prefix='pi-secure-demo-'))
(WORK/'home').mkdir(); (WORK/'agent').mkdir()
(WORK/'agent'/'settings.json').write_text(json.dumps({'quietStartup': True, 'theme': 'dark', 'showChangelog': False}))
master, slave = pty.openpty()
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 25, 112, 0, 0))
node_dir = str(Path(subprocess.check_output(['which','node'], text=True).strip()).parent)
pi = subprocess.check_output(['which','pi'], text=True).strip()
env = {'PATH': node_dir + ':/opt/homebrew/bin:/usr/bin:/bin', 'HOME': str(WORK/'home'), 'PI_CODING_AGENT_DIR': str(WORK/'agent'), 'PI_OFFLINE': '1', 'TERM': 'xterm-256color', 'COLORTERM': 'truecolor', 'LANG': 'en_US.UTF-8', 'SHELL': '/bin/sh'}
args = [pi, '--offline', '--no-session', '--no-extensions', '--no-skills', '--no-prompt-templates', '--no-context-files', '--no-themes', '--no-mcp', '--no-builtin-tools', '--no-approve', '--theme', str(ROOT/'scripts/demo/secure-demo.json'), '--use-theme', 'secure-demo', '--model', 'anthropic/claude-sonnet-4-6', '--api-key', 'demo-only-not-a-real-credential', '-e', str(ROOT/'scripts/demo/driver.ts')]
p = subprocess.Popen(args, cwd=WORK, env=env, stdin=slave, stdout=slave, stderr=slave, start_new_session=True)
os.close(slave)
screen = pyte.Screen(112,25); stream = pyte.Stream(screen); decoder = codecs.getincrementaldecoder('utf-8')(errors='replace')
frames = []; raw = bytearray(); start=time.monotonic(); sent=False; capture_start=None; next_frame=0
while time.monotonic()-start < 45:
    if select.select([master],[],[],0.02)[0]:
        try: chunk=os.read(master,65536)
        except OSError: break
        if not chunk: break
        raw.extend(chunk)
        if b'\x1b[6n' in chunk: os.write(master,b'\x1b[1;1R')
        stream.feed(decoder.decode(chunk))
    now=time.monotonic()
    if not sent and now-start>3:
        os.write(master,b'/demo\r'); sent=True; capture_start=now
    if capture_start is not None and now-capture_start>=next_frame:
        frames.append({'time': round(now-capture_start,3), 'rows': [[{'c':screen.buffer[y][x].data, 'fg': screen.buffer[y][x].fg, 'bg':screen.buffer[y][x].bg, 'bold':screen.buffer[y][x].bold, 'reverse':screen.buffer[y][x].reverse} for x in range(112)] for y in range(25)]})
        next_frame += 0.1
    if p.poll() is not None: break
if p.poll() is None: p.terminate()
(WORK/'capture.ansi').write_bytes(raw)
(WORK/'frames.json').write_text(json.dumps(frames))
print(WORK)
print('frames:',len(frames),'seconds:',frames[-1]['time'] if frames else 0)
print('\n'.join(screen.display))

#!/usr/bin/env python3
"""Render a PTY capture using pyte's terminal cells, with editorial framing.
Usage: python3 scripts/demo/render.py /tmp/pi-secure-demo-.../frames.json
Dependencies: Pillow. ffmpeg and ffprobe must be on PATH (or /opt/homebrew/bin).
No network requests, browser, credentials, or native clipboard are used.
"""
import json, sys, subprocess, tempfile, re
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT/'docs/media'; OUT.mkdir(parents=True,exist_ok=True)
FRAMES = json.loads(Path(sys.argv[1]).read_text())
TMP = Path(tempfile.mkdtemp(prefix='pi-secure-render-'))
FONT='/System/Library/Fonts/Menlo.ttc'
SERIF='/System/Library/Fonts/Supplemental/Georgia.ttf'
SANS='/System/Library/Fonts/Supplemental/Arial.ttf'
fonts = { 'mono': ImageFont.truetype(FONT,16), 'small':ImageFont.truetype(FONT,12), 'body':ImageFont.truetype(SANS,17), 'caption':ImageFont.truetype(SANS,21), 'title':ImageFont.truetype(SERIF,43), 'boundary':ImageFont.truetype(SANS,14) }
PAPER='#f5f2eb'; INK='#272923'; MUTED='#65665d'; ACCENT='#a54120'; DARK='#242822'
PALETTE={'default':'#f0efe7','black':'#242822','red':'#f28b82','green':'#b8c99c','brown':'#e7bb81','blue':'#8eb8cf','magenta':'#c9a7d8','cyan':'#a8d3cc','white':'#f0efe7','brightblack':'#88917e','brightwhite':'#ffffff'}
def color(c, default):
    if c=='default': return default
    if c in PALETTE: return PALETTE[c]
    if re.fullmatch('[a-fA-F0-9]{6}',c): return '#'+c
    return default
CUES=[
 (0,3.4,'01 / Request privately. The input stays masked.'),
 (3.4,4.4,'Only the name and availability are returned.'),
 (4.4,8.5,'02 / Use the environment variable. Exact output is redacted.'),
 (8.5,10.2,'03 / Inspect locally. The secret starts masked.'),
 (10.2,12,'C → Y confirms copy. Clipboard is simulated in this demo.'),
 (12,14.3,'Copy succeeds without revealing. Native clipboard untouched.'),
 (14.3,16.2,'R → Y confirms reveal. Recordings can retain the value.'),
 (16.2,18.7,'Fake value revealed locally, then hidden again.'),
 (18.7,23.1,'04 / Clear the vault. The secret is no longer available.'),
 (23.1,26,'Transcript hygiene, not a security boundary.'),
]
def caption(t):
    return next((s for a,b,s in CUES if a<=t<b),CUES[-1][2])
def render(frame, t, thumbnail=False):
    im=Image.new('RGB',(1280,800),PAPER); d=ImageDraw.Draw(im)
    d.text((48,25),'[ π ]  pi-secure',font=fonts['body'],fill=INK)
    d.text((940,29),'LOCAL SECRETS / REAL PI UI',font=fonts['small'],fill=ACCENT)
    d.text((46,65),'Secrets stay out of the conversation.',font=fonts['title'],fill=INK)
    d.text((49,126),'Request privately. Use by name. Reveal only when you choose.',font=fonts['body'],fill=MUTED)
    # Editorial window chrome; everything below it is actual captured terminal cells.
    d.rounded_rectangle((48,177,1232,687),radius=9,fill='#dedbd2')
    d.rounded_rectangle((48,173,1232,682),radius=8,fill=DARK)
    d.line((49,207,1231,207),fill='#41473d')
    for x in [67,82,97]: d.ellipse((x,187,x+6,193),fill='#87907c')
    d.text((114,182),'pi-secure  /  isolated offline terminal session',font=fonts['small'],fill='#bbc2b3')
    d.text((1035,182),'SCRIPTED DEMO',font=fonts['small'],fill='#f0ac82')
    x0,y0,cw,ch=80,208,10,18.5
    for y,row in enumerate(frame['rows']):
        for x,cell in enumerate(row):
            fg=color(cell['fg'],'#f0efe7'); bg=color(cell['bg'],DARK)
            if cell.get('reverse'): fg,bg=bg,fg
            px,py=x0+x*cw,y0+y*ch
            if bg!=DARK: d.rectangle((px,py,px+cw,py+ch),fill=bg)
            if cell['c'] and cell['c']!=' ': d.text((px,py),cell['c'],font=fonts['mono'],fill=fg)
    text='Masked locally. Redacted in command output.' if thumbnail else caption(t)
    d.text((49,700),text,font=fonts['caption'],fill=ACCENT)
    d.text((49,738),'Real Pi UI · scripted inputs · no model calls · fake credential only · clipboard copy simulated',font=fonts['small'],fill=MUTED)
    d.text((49,770),'Transcript hygiene, not a sandbox. Not protection from a malicious or prompt-injected model.',font=fonts['boundary'],fill=INK)
    return im
# Resample the real terminal states onto a 10 fps timeline. This changes only timing.
idx=0
for n in range(260):
    t=n/10
    while idx+1<len(FRAMES) and FRAMES[idx+1]['time']<=t: idx+=1
    render(FRAMES[idx],t).save(TMP/f'{n:04}.png')
preview=min(FRAMES,key=lambda a:abs(a['time']-9.1))
render(preview,9.1,True).save(OUT/'preview.png',optimize=True)
subprocess.run(['/opt/homebrew/bin/ffmpeg','-y','-hide_banner','-loglevel','warning','-framerate','10','-i',str(TMP/'%04d.png'),'-c:v','libx264','-preset','slow','-crf','18','-pix_fmt','yuv420p','-r','30','-movflags','+faststart','-an',str(OUT/'demo.mp4')],check=True)
def ts(s):
    return f'00:{int(s)//60:02}:{s%60:06.3f}'
(OUT/'demo.vtt').write_text('WEBVTT\n\n'+'\n\n'.join(f'{ts(a)} --> {ts(b)}\n{s}' for a,b,s in CUES)+'\n')
print('Rendered assets:',OUT)

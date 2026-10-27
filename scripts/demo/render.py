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
DURATION = 32
CUES=[
 (0,4.5,'Private request: asterisks grow with every typed character.'),
 (4.5,5.4,'Only the name and availability enter the conversation.'),
 (5.4,8.6,'secure_exec authenticates to localhost. Build 184 passed.'),
 (8.6,10.3,'/secret show BUILD_TOKEN opens the masked local dialog.'),
 (10.3,12.0,'R asks for confirmation. Y reveals locally.'),
 (12.0,14.8,'Synthetic token only. R hides it; Enter closes. No clipboard.'),
 (14.8,19.7,'/secret list: scroll through names and select a secret.'),
 (19.7,22.0,'Enter opens the selected secret, masked. Close to return.'),
 (22.0,25.7,'D asks to forget the selection. Y confirms.'),
 (25.7,28.0,'The browser refreshes: the selected name is gone.'),
 (28.0,30.5,'/secret clear forgets the remaining in-memory secrets.'),
 (30.5,32.0,'Transcript hygiene, not a sandbox. Clearing cannot erase recordings.'),
]
def caption(t):
    return next((s for a,b,s in CUES if a<=t<b),CUES[-1][2])
def render(frame, t, thumbnail=False):
    im=Image.new('RGB',(1280,800),PAPER); d=ImageDraw.Draw(im)
    d.text((48,25),'[ π ]  pi-secure',font=fonts['body'],fill=INK)
    d.text((1090,29),'Example workflow',font=fonts['small'],fill=ACCENT)
    d.text((46,65),'Keep tokens local.',font=fonts['title'],fill=INK)
    d.text((49,126),'Request privately. Inspect locally. Browse and forget by name.',font=fonts['body'],fill=MUTED)
    # Editorial window chrome; everything below it is actual captured terminal cells.
    d.rounded_rectangle((48,177,1232,687),radius=9,fill='#dedbd2')
    d.rounded_rectangle((48,173,1232,682),radius=8,fill=DARK)
    d.line((49,207,1231,207),fill='#41473d')
    for x in [67,82,97]: d.ellipse((x,187,x+6,193),fill='#87907c')
    d.text((114,182),'pi  /  private build',font=fonts['small'],fill='#bbc2b3')
    x0,y0,cw,ch=80,208,10,18.5
    for y,row in enumerate(frame['rows']):
        for x,cell in enumerate(row):
            fg=color(cell['fg'],'#f0efe7'); bg=color(cell['bg'],DARK)
            if cell.get('reverse'): fg,bg=bg,fg
            px,py=x0+x*cw,y0+y*ch
            if bg!=DARK: d.rectangle((px,py,px+cw,py+ch),fill=bg)
            if cell['c'] and cell['c']!=' ': d.text((px,py),cell['c'],font=fonts['mono'],fill=fg)
    text='/secret show BUILD_TOKEN · masked, local-only inspection' if thumbnail else caption(t)
    d.text((49,700),text,font=fonts['caption'],fill=ACCENT)
    return im
# Resample the real terminal states onto a 10 fps timeline. This changes only timing.
idx=0
for n in range(DURATION * 10):
    t=n/10
    while idx+1<len(FRAMES) and FRAMES[idx+1]['time']<=t: idx+=1
    render(FRAMES[idx],t).save(TMP/f'{n:04}.png')
preview=min(FRAMES,key=lambda a:abs(a['time']-9.5))
render(preview,9.5,True).save(OUT/'preview.png',optimize=True)
subprocess.run(['/opt/homebrew/bin/ffmpeg','-y','-hide_banner','-loglevel','warning','-framerate','10','-i',str(TMP/'%04d.png'),'-c:v','libx264','-preset','slow','-crf','18','-pix_fmt','yuv420p','-r','30','-movflags','+faststart','-an',str(OUT/'demo.mp4')],check=True)
def ts(s):
    return f'00:{int(s)//60:02}:{s%60:06.3f}'
(OUT/'demo.vtt').write_text('WEBVTT\n\n'+'\n\n'.join(f'{ts(a)} --> {ts(b)}\n{s}' for a,b,s in CUES)+'\n')
print('Rendered assets:',OUT)

"""Encode real browser screenshots as a captioned, shortened walkthrough."""
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT=Path(__file__).resolve().parents[1]
report=json.loads((ROOT/'temp/browser-validation/tutorial/report.json').read_text(encoding='utf-8'))
frames=[]
for shot in report['shots']:
    with Image.open(ROOT/'tutorial/images'/shot['file']) as screenshot:
        screenshot=screenshot.convert('RGB')
        screenshot.thumbnail((1152,800),Image.Resampling.LANCZOS)
        frame=Image.new('RGB',(1152,864),'#eff5f6')
        frame.paste(screenshot,(0,64))
        draw=ImageDraw.Draw(frame)
        try:font=ImageFont.truetype('DejaVuSans.ttf',19)
        except OSError:
            try:font=ImageFont.truetype('C:/Windows/Fonts/segoeui.ttf',19)
            except OSError:font=ImageFont.load_default(size=19)
        draw.text((18,10),shot['caption'],fill='#163a45',font=font)
        draw.text((18,36),'Fictional notes · real local inference · loading waits shortened',fill='#526976',font=font)
        frames.append(frame.quantize(colors=192))
out=ROOT/'tutorial/images/nextmedtator-walkthrough.gif'
frames[0].save(out,save_all=True,append_images=frames[1:],duration=3200,loop=0,optimize=True,disposal=2)
print(f'{out}: {len(frames)} captured steps, {out.stat().st_size:,} bytes')

"""Encode real browser screenshots as a captioned, shortened walkthrough."""
import json,argparse
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser();parser.add_argument('--collection',action='store_true');args=parser.parse_args()
report={'shots':[{'file':file,'caption':caption} for file,caption in [('21-model-memory.png','1. Load models on request; unload weights when finished'),('22-long-note-review.png','2. Scan long notes; filter, page and undo suggestions'),('23-collection-storage.png','3. Explicitly store a collection on this device'),('24-collection-resume.png','4. Pause, reload and resume; completed notes stay completed')]]} if args.collection else json.loads((ROOT/'temp/browser-validation/tutorial/report.json').read_text(encoding='utf-8'))
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
out=ROOT/'tutorial/images'/('collection-walkthrough.gif' if args.collection else 'nextmedtator-walkthrough.gif')
frames[0].save(out,save_all=True,append_images=frames[1:],duration=3200,loop=0,optimize=True,disposal=2)
print(f'{out}: {len(frames)} captured steps, {out.stat().st_size:,} bytes')

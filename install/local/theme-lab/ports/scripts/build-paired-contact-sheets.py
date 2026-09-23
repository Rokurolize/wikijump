#!/usr/bin/env python3
"""Build four reproducible side-by-side EN reference / SCP-JP candidate sheets."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
SLUGS = [
    "bedrock", "basalt", "foxtrot", "black-highlighter-theme", "site", "isolated-terminal",
    "penumbra", "scpedia", "al-slop", "wikifot", "classic", "sigma", "y2k", "yossistyle",
    "space", "jakstyle", "pataphysics", "turbo-vision", "skipos", "extra-black-highlighter-theme",
    "aesthetic-theme", "flopstyle-dark", "much-cool", "inkblot", "scheme", "paperstack", "cosmonaut",
    "monotypical", "minimalist-bhl", "hansarp", "night-rush-theme", "scp-offices-theme", "redtape",
    "ouroborous-theme",
]
VIEWPORTS = ("desktop", "laptop", "tablet", "mobile")
THUMB = (360, 240)
CELL = (THUMB[0] * 2, THUMB[1] + 38)
COLS = 4
FONT = ImageFont.load_default()

for viewport in VIEWPORTS:
    rows = (len(SLUGS) + COLS - 1) // COLS
    sheet = Image.new("RGB", (COLS * CELL[0], rows * CELL[1]), "#d6d6d6")
    draw = ImageDraw.Draw(sheet)
    for i, slug in enumerate(SLUGS):
        x, y = (i % COLS) * CELL[0], (i // COLS) * CELL[1]
        draw.text((x + 3, y + 3), f"{slug} | EN reference", fill="#111", font=FONT)
        draw.text((x + THUMB[0] + 3, y + 3), "SCP-JP candidate", fill="#111", font=FONT)
        for offset, key in ((0, "reference"), (THUMB[0], "candidate")):
            path = ROOT / slug / "artifacts" / f"{key}-{viewport}.png"
            if not path.is_file():
                raise SystemExit(f"missing screenshot: {path}")
            image = Image.open(path).convert("RGB")
            image.thumbnail(THUMB, Image.Resampling.LANCZOS)
            sheet.paste(image, (x + offset, y + 20))
    target = ROOT / f"paired-contact-{viewport}.jpg"
    sheet.save(target, quality=88, optimize=True)
    print(target.relative_to(ROOT.parent))

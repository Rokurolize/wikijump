#!/usr/bin/env python3
"""Build hash-verified visual-review contact sheets from the Sigma-10 worklist."""
import hashlib
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

THEME_LAB = Path(__file__).resolve().parents[2]
PORTS = THEME_LAB / "ports"
WORKLIST = THEME_LAB / "sigma10-migration/current-campaign/final-vcm-acceptance-20261007/visual-review-worklist.json"
OUTPUT = THEME_LAB / "sigma10-migration/current-campaign/final-vcm-acceptance-20261007/contact-sheets-v2"

def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()

def context_label(group: dict) -> list[str]:
    contexts = group["contexts"]
    first = contexts[0]
    lines = [f'{first["theme"]}  {first["browser_engine"]}/{first["viewport"]}',
             f'{first["surface"]}.{first["state"]}  [{first["visual_class"]}]  {group["screenshot_sha256"][:10]}']
    if len(contexts) > 1:
        lines.append(f"+ {len(contexts) - 1} exact-hash row(s)")
    return lines

def main() -> None:
    worklist_bytes = WORKLIST.read_bytes()
    worklist = json.loads(worklist_bytes)
    OUTPUT.mkdir(parents=True, exist_ok=True)
    buckets: dict[tuple[str, int, int], list[dict]] = {}
    for group in worklist["groups"]:
        sources = [PORTS / relative for relative in group["paths"]]
        for source in sources:
            if digest(source) != group["screenshot_sha256"]:
                raise RuntimeError(f"screenshot bytes differ from exact audit SHA: {source}")
        source = sources[0]
        with Image.open(source) as opened:
            width, height = opened.size
        orientation = "landscape" if width >= height else "portrait"
        group["dimensions"] = [width, height]
        buckets.setdefault((orientation,), []).append(group)

    contact_sheets = []
    reviewed_groups = []
    for bucket_index, ((orientation,), groups) in enumerate(sorted(buckets.items()), 1):
        columns, rows_per_sheet = 4, 4
        per_sheet = columns * rows_per_sheet
        tile_width = 360
        tile_height = 270 if orientation == "landscape" else 460
        image_bounds = (tile_width - 20, tile_height - (68 if orientation == "landscape" else 70))
        for offset in range(0, len(groups), per_sheet):
            subset = groups[offset:offset + per_sheet]
            sheet_number = len(contact_sheets) + 1
            name = f'{orientation}-{bucket_index:02d}-{sheet_number:03d}.jpg'
            sheet = Image.new("RGB", (columns * tile_width, rows_per_sheet * tile_height), "#d8d8dc")
            draw = ImageDraw.Draw(sheet)
            font = ImageFont.load_default(size=13)
            for index, group in enumerate(subset):
                col, row = index % columns, index // columns
                x, y = col * tile_width, row * tile_height
                draw.rectangle((x + 3, y + 3, x + tile_width - 4, y + tile_height - 4), fill="white", outline="#767680", width=2)
                source = PORTS / group["paths"][0]
                if digest(source) != group["screenshot_sha256"]:
                    raise RuntimeError(f"screenshot changed after initial hash verification: {source}")
                with Image.open(source) as opened:
                    image = opened.convert("RGB")
                image.thumbnail(image_bounds, Image.Resampling.LANCZOS)
                image_x = x + (tile_width - image.width) // 2
                image_y = y + 6
                sheet.paste(image, (image_x, image_y))
                label_top = y + tile_height - (68 if orientation == "landscape" else 70)
                draw.line((x + 6, label_top - 4, x + tile_width - 6, label_top - 4), fill="#bbbbc2", width=1)
                labels = context_label(group)
                draw.multiline_text((x + 8, label_top), "\n".join(labels), fill="#16161a", font=font, spacing=3)
                reviewed_groups.append({**group, "sheet": name, "tile_index": index + 1})
            output = OUTPUT / name
            sheet.save(output, format="JPEG", quality=91, optimize=True)
            contact_sheets.append({"path": output.relative_to(THEME_LAB).as_posix(), "sha256": digest(output), "groups": len(subset), "dimensions": list(sheet.size)})

    manifest = {
        "schema": "theme_lab_sigma10_exact_screenshot_contact_sheets.v1",
        "generated_at": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
        "candidate_set_sha256": worklist["candidate_set_sha256"],
        "run_contract_sha256": worklist["run_contract"]["sha256"],
        "audit_sha256": worklist["audit"]["sha256"],
        "worklist_sha256": hashlib.sha256(worklist_bytes).hexdigest(),
        "worklist_path": WORKLIST.relative_to(THEME_LAB).as_posix(),
        "unique_images": len(reviewed_groups),
        "sheet_count": len(contact_sheets),
        "contact_sheets": contact_sheets,
        "groups": reviewed_groups,
    }
    manifest_path = OUTPUT / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"status": "ready", "unique_images": len(reviewed_groups), "sheets": len(contact_sheets), "manifest": manifest_path.relative_to(THEME_LAB).as_posix(), "worklist_sha256": manifest["worklist_sha256"]}, ensure_ascii=False))

if __name__ == "__main__":
    main()

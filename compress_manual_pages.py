"""
Downscale/compress the full-res 'Manual Pages' scans into a much smaller
'Manual Pages Compressed' copy, for easy reading/reference (not for print).
Originals are left untouched.

Usage:
    python compress_manual_pages.py [--max-dim 2000] [--quality 85]
"""
import argparse
import sys
import time
from pathlib import Path
from PIL import Image

SRC_DIR = Path(__file__).parent / "Manual Pages"
DST_DIR = Path(__file__).parent / "Manual Pages Compressed"


def compress_one(src_path: Path, dst_path: Path, max_dim: int, quality: int) -> tuple[int, int]:
    with Image.open(src_path) as im:
        im = im.convert("RGB")
        w, h = im.size
        scale = min(1.0, max_dim / max(w, h))
        if scale < 1.0:
            im = im.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.LANCZOS)
        im.save(dst_path, "JPEG", quality=quality, optimize=True)
    return src_path.stat().st_size, dst_path.stat().st_size


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--max-dim", type=int, default=2000, help="max width/height in px")
    parser.add_argument("--quality", type=int, default=85, help="JPEG quality (1-95)")
    args = parser.parse_args()

    if not SRC_DIR.is_dir():
        sys.exit(f"Source folder not found: {SRC_DIR}")
    DST_DIR.mkdir(exist_ok=True)

    files = sorted(p for p in SRC_DIR.iterdir() if p.suffix.lower() in (".png", ".jpg", ".jpeg"))
    if not files:
        sys.exit("No image files found.")

    total_src = total_dst = 0
    start = time.time()
    for i, src in enumerate(files, 1):
        dst = DST_DIR / (src.stem + ".jpg")
        src_size, dst_size = compress_one(src, dst, args.max_dim, args.quality)
        total_src += src_size
        total_dst += dst_size
        print(f"[{i}/{len(files)}] {src.name}: {src_size/1e6:.1f}MB -> {dst_size/1e6:.2f}MB")

    elapsed = time.time() - start
    print(f"\nDone in {elapsed:.1f}s. {len(files)} files.")
    print(f"Total: {total_src/1e6:.1f}MB -> {total_dst/1e6:.1f}MB "
          f"({100 * (1 - total_dst/total_src):.1f}% smaller)")


if __name__ == "__main__":
    main()

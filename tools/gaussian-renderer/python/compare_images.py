#!/usr/bin/env python3
"""Compare rendered images: PSNR, SSIM and largest difference, optional montage.

  compare_images.py reference.png test.png [test2.png ...] [--montage out.png] [--labels a b c]
"""
import argparse
import json

import numpy as np
from PIL import Image, ImageDraw
from skimage.metrics import structural_similarity


def load(path):
    return np.asarray(Image.open(path).convert("RGB"), dtype=np.float64) / 255.0


def metrics(ref, test, blur=0.0):
    if blur > 0:
        from scipy import ndimage
        ref = ndimage.gaussian_filter(ref, sigma=(blur, blur, 0))
        test = ndimage.gaussian_filter(test, sigma=(blur, blur, 0))
    diff = test - ref
    mse = float(np.mean(diff ** 2))
    psnr = float("inf") if mse == 0 else 10.0 * np.log10(1.0 / mse)
    ssim = float(structural_similarity(ref, test, channel_axis=2, data_range=1.0))
    # also restricted to pixels where either image is not background
    fg = (ref.max(axis=2) > 2 / 255) | (test.max(axis=2) > 2 / 255)
    mse_fg = float(np.mean(diff[fg] ** 2)) if fg.any() else 0.0
    psnr_fg = float("inf") if mse_fg == 0 else 10.0 * np.log10(1.0 / mse_fg)
    return {
        "psnr": psnr,
        "psnrForeground": psnr_fg,
        "ssim": ssim,
        "maxAbsDiff": float(np.abs(diff).max()),
        "meanAbsDiff": float(np.abs(diff).mean()),
        "differingPixels": float(np.mean(np.abs(diff).max(axis=2) > 0.5 / 255)),
        "foregroundFraction": float(fg.mean()),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("reference")
    ap.add_argument("tests", nargs="+")
    ap.add_argument("--montage")
    ap.add_argument("--labels", nargs="*")
    ap.add_argument("--diff-gain", type=float, default=4.0)
    ap.add_argument("--json")
    ap.add_argument("--blur", type=float, default=1.5,
                    help="also report the metrics after a Gaussian blur of this many pixels, which removes the sampling grain")
    args = ap.parse_args()

    ref = load(args.reference)
    results = {}
    tiles = [ref]
    for path in args.tests:
        test = load(path)
        results[path] = metrics(ref, test)
        tiles.append(test)
        m = results[path]
        line = (f"{path}\n   PSNR {m['psnr']:.2f} dB, SSIM {m['ssim']:.4f}, "
                f"mean diff {m['meanAbsDiff'] * 255:.2f}/255, max diff {m['maxAbsDiff'] * 255:.0f}/255")
        if args.blur > 0:
            b = metrics(ref, test, args.blur)
            results[path]["blurred"] = {"sigma": args.blur, "psnr": b["psnr"], "ssim": b["ssim"], "meanAbsDiff": b["meanAbsDiff"]}
            line += f"\n   after a {args.blur:g} px blur: PSNR {b['psnr']:.2f} dB, SSIM {b['ssim']:.4f}"
        print(line)
    if args.json:
        with open(args.json, "w") as f:
            json.dump(results, f, indent=2)
    if args.montage:
        h, w, _ = ref.shape
        rows = [np.concatenate(tiles, axis=1)]
        diffs = [np.zeros_like(ref)] + [np.clip(np.abs(t - ref) * args.diff_gain, 0, 1) for t in tiles[1:]]
        rows.append(np.concatenate(diffs, axis=1))
        img = Image.fromarray((np.concatenate(rows, axis=0) * 255).astype(np.uint8))
        draw = ImageDraw.Draw(img)
        labels = args.labels or (["reference"] + args.tests)
        for i, label in enumerate(labels[:len(tiles)]):
            draw.text((i * w + 6, 4), label, fill=(255, 255, 255))
            if i > 0:
                draw.text((i * w + 6, h + 4), f"|difference| x{args.diff_gain:g}", fill=(255, 255, 255))
        img.save(args.montage)


if __name__ == "__main__":
    main()

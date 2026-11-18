#!/usr/bin/env python3
"""Synthetic scene of randomly oriented, strongly anisotropic Gaussians.

It exercises what the lattice fit does not: rotated covariances, a wide range
of sizes, overlap of unequal kernels, and a volume that is not a cube.

  make_test_scene.py --out scenes/aniso.json
"""
import argparse

import numpy as np

from gaussian_io import write_scene


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--dims", type=int, nargs=3, default=[160, 128, 96])
    ap.add_argument("--count", type=int, default=1500)
    ap.add_argument("--seed", type=int, default=7)
    args = ap.parse_args()
    rng = np.random.default_rng(args.seed)
    dims = np.array(args.dims, dtype=np.float64)
    n = args.count
    # three clusters, one per class, plus scattered primitives
    centres = np.array([[0.3, 0.35, 0.5], [0.62, 0.6, 0.45], [0.5, 0.3, 0.6]]) * dims
    cls = rng.integers(0, 3, size=n)
    means = centres[cls] + rng.normal(0, 0.16, size=(n, 3)) * dims.min()
    means = np.clip(means, 6, dims - 6)
    long_axis = rng.uniform(3.0, 11.0, size=n)
    scales = np.stack([long_axis, long_axis * rng.uniform(0.15, 0.6, size=n), long_axis * rng.uniform(0.12, 0.4, size=n)], axis=1)
    quats = rng.normal(size=(n, 4))
    quats /= np.linalg.norm(quats, axis=1, keepdims=True)
    weights = np.zeros((n, 4), dtype=np.float32)
    weights[np.arange(n), cls] = rng.uniform(0.08, 0.3, size=n)
    weights[:, 3] = rng.uniform(0.12, 0.3, size=n)
    header = write_scene(args.out, means.astype(np.float32), scales.astype(np.float32), quats.astype(np.float32),
                         weights, args.dims, ["ClassA", "ClassB", "ClassC", "Raw"])
    print(f"wrote {header['count']} Gaussians, volume {args.dims}")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Voxelise a Gaussian scene with the kernel the renderer evaluates.

Writes one uint8 volume per channel (x fastest, then y, then z). Used to give
the voxel renderer the very same field the Gaussian renderer sees.

  voxelize.py scene.json --prefix out/scene_vox
"""
import argparse

import numpy as np

from gaussian_io import kernel_value, read_scene


def rotation_matrices(quats):
    q = quats / np.maximum(np.linalg.norm(quats, axis=1, keepdims=True), 1e-12)
    w, x, y, z = q[:, 0], q[:, 1], q[:, 2], q[:, 3]
    r = np.empty((len(q), 3, 3))
    r[:, 0, 0] = 1 - 2 * (y * y + z * z); r[:, 0, 1] = 2 * (x * y - w * z); r[:, 0, 2] = 2 * (x * z + w * y)
    r[:, 1, 0] = 2 * (x * y + w * z); r[:, 1, 1] = 1 - 2 * (x * x + z * z); r[:, 1, 2] = 2 * (y * z - w * x)
    r[:, 2, 0] = 2 * (x * z - w * y); r[:, 2, 1] = 2 * (y * z + w * x); r[:, 2, 2] = 1 - 2 * (x * x + y * y)
    return r


def voxelize(header, data):
    nx, ny, nz = (header["volumeSize"][k] for k in "xyz")
    cutoff = header["kernel"]["cutoffSigma"]
    shifted = header["kernel"]["shifted"]
    channels = len(header["channels"])
    vol = np.zeros((channels, nz, ny, nx), dtype=np.float32)
    means, scales, quats, weights = data[:, 0:3], data[:, 3:6], data[:, 6:10], data[:, 10:10 + channels]
    rot = rotation_matrices(quats.astype(np.float64))
    for i in range(len(data)):
        r = rot[i]
        var = scales[i].astype(np.float64) ** 2
        cov = (r * var) @ r.T
        inv = (r / var) @ r.T
        half = cutoff * np.sqrt(np.diag(cov))
        lo = np.maximum(np.floor(means[i] - half - 0.5).astype(int), 0)
        hi = np.minimum(np.ceil(means[i] + half + 0.5).astype(int), [nx, ny, nz])
        if np.any(hi <= lo):
            continue
        # voxel centres relative to the mean
        dx = np.arange(lo[0], hi[0]) + 0.5 - means[i, 0]
        dy = np.arange(lo[1], hi[1]) + 0.5 - means[i, 1]
        dz = np.arange(lo[2], hi[2]) + 0.5 - means[i, 2]
        gz, gy, gx = np.meshgrid(dz, dy, dx, indexing="ij")
        q = (inv[0, 0] * gx * gx + inv[1, 1] * gy * gy + inv[2, 2] * gz * gz
             + 2 * (inv[0, 1] * gx * gy + inv[0, 2] * gx * gz + inv[1, 2] * gy * gz))
        k = kernel_value(q, cutoff, shifted).astype(np.float32)
        for c in range(channels):
            if weights[i, c] != 0:
                vol[c, lo[2]:hi[2], lo[1]:hi[1], lo[0]:hi[0]] += weights[i, c] * k
    return vol


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("scene")
    ap.add_argument("--prefix", required=True)
    args = ap.parse_args()
    header, data = read_scene(args.scene)
    vol = voxelize(header, data)
    for c, name in enumerate(header["channels"]):
        np.clip(np.rint(vol[c] * 255.0), 0, 255).astype(np.uint8).tofile(f"{args.prefix}_{name}.raw")
        print(f"{name}: max {vol[c].max():.3f}, mean {vol[c].mean():.4f}")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Fit isotropic Gaussians on a regular lattice to up to four uint8 voxel channels.

Geometry is shared by all channels; each Gaussian carries one non-negative
weight per channel. Gaussians are kept only where the class channels have
support, so empty background gets no primitives. The weights are the
non-negative least-squares solution for the kernel the renderer evaluates,
found with accelerated projected gradient steps on the lattice.

Example:
  fit_lattice.py --dims 256 256 448 --spacing 2 --out scene.json \
      --class spikes.raw --class membrane.raw --class inner.raw --raw tomogram.raw
"""
import argparse
import time

import numpy as np

from gaussian_io import kernel_value, write_scene


def lattice_stencil(spacing, sigma, cutoff_sigma, shifted):
    """Kernel values on the voxel offsets around a lattice node.

    A node sits at continuous voxel coordinate (i + 0.5) * spacing; voxel
    centres sit at j + 0.5. Returns (offsets, values) where offsets are the
    integer voxel offsets relative to voxel index i * spacing."""
    centre = 0.5 * spacing - 0.5  # node position relative to voxel index i*spacing, in voxel-centre units
    r = int(np.ceil(cutoff_sigma * sigma + 1))
    o = np.arange(int(np.floor(centre)) - r, int(np.ceil(centre)) + r + 1)
    oz, oy, ox = np.meshgrid(o, o, o, indexing="ij")
    q = ((ox - centre) ** 2 + (oy - centre) ** 2 + (oz - centre) ** 2) / sigma ** 2
    k = kernel_value(q, cutoff_sigma, shifted)
    keep = k > 0
    return np.stack([oz[keep], oy[keep], ox[keep]], axis=1), k[keep].astype(np.float32)


def forward(weights, offsets, values, spacing, shape):
    """Voxelise lattice weights: A w. weights has lattice shape (lz, ly, lx)."""
    pad = int(np.abs(offsets).max()) + spacing
    out = np.zeros(tuple(s + 2 * pad for s in shape), dtype=np.float32)
    lz, ly, lx = weights.shape
    for (oz, oy, ox), k in zip(offsets, values):
        out[pad + oz:pad + oz + lz * spacing:spacing,
            pad + oy:pad + oy + ly * spacing:spacing,
            pad + ox:pad + ox + lx * spacing:spacing] += k * weights
    return out[pad:pad + shape[0], pad:pad + shape[1], pad:pad + shape[2]]


def adjoint(volume, offsets, values, spacing, lattice_shape):
    """A^T d: correlate a voxel volume with the kernel at the lattice nodes."""
    pad = int(np.abs(offsets).max()) + spacing
    padded = np.pad(volume, pad)
    lz, ly, lx = lattice_shape
    out = np.zeros(lattice_shape, dtype=np.float32)
    for (oz, oy, ox), k in zip(offsets, values):
        out += k * padded[pad + oz:pad + oz + lz * spacing:spacing,
                          pad + oy:pad + oy + ly * spacing:spacing,
                          pad + ox:pad + ox + lx * spacing:spacing]
    return out


def normal_stencil(offsets, values, spacing):
    """Lattice stencil of A^T A (identical for every node because the spacing is an integer)."""
    reach = int(np.ceil((np.abs(offsets).max() * 2 + 1) / spacing)) + 1
    size = 2 * reach + 1
    g = np.zeros((size, size, size), dtype=np.float64)
    table = {tuple(o): float(v) for o, v in zip(offsets.tolist(), values.tolist())}
    for (oz, oy, ox), k in table.items():
        for mz in range(-reach, reach + 1):
            for my in range(-reach, reach + 1):
                for mx in range(-reach, reach + 1):
                    other = table.get((oz - mz * spacing, oy - my * spacing, ox - mx * spacing))
                    if other is not None:
                        g[mz + reach, my + reach, mx + reach] += k * other
    return g, reach


def fit_channel(rhs, mask, g_hat, lipschitz, iterations, log, name):
    """FISTA for min ||A w - d||^2 with w >= 0 and w = 0 outside the mask."""
    w = np.zeros_like(rhs)
    y = w.copy()
    t = 1.0
    apply_normal = lambda x: np.fft.irfftn(np.fft.rfftn(x) * g_hat, s=x.shape, axes=(0, 1, 2)).astype(np.float32)
    for it in range(iterations):
        grad = apply_normal(y) - rhs
        w_new = np.maximum(y - grad / lipschitz, 0.0) * mask
        t_new = 0.5 * (1.0 + np.sqrt(1.0 + 4.0 * t * t))
        y = w_new + ((t - 1.0) / t_new) * (w_new - w)
        change = float(np.abs(w_new - w).max())
        w, t = w_new, t_new
        if log and (it % 10 == 9 or it == iterations - 1):
            print(f"    {name}: iteration {it + 1}, largest weight change {change:.2e}")
        if change < 2e-4:
            break
    return w


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dims", type=int, nargs=3, required=True, metavar=("X", "Y", "Z"))
    ap.add_argument("--class", dest="classes", action="append", default=[], help="uint8 class probability volume (repeatable, at most 3 with --raw)")
    ap.add_argument("--raw", help="uint8 tomogram volume, fitted inside the class support only")
    ap.add_argument("--names", nargs="*", help="channel names for the header")
    ap.add_argument("--spacing", type=int, default=2, help="lattice spacing in voxels")
    ap.add_argument("--sigma-ratio", type=float, default=0.5, help="standard deviation as a fraction of the spacing")
    ap.add_argument("--cutoff-sigma", type=float, default=3.0)
    ap.add_argument("--no-shift", action="store_true", help="plain truncated Gaussian instead of the shifted kernel")
    ap.add_argument("--support", type=float, default=0.03, help="class value above which a voxel counts as occupied")
    ap.add_argument("--prune", type=float, default=0.004, help="drop Gaussians whose class weights are all below this")
    ap.add_argument("--iterations", type=int, default=120)
    ap.add_argument("--out", required=True, help="output .json path")
    ap.add_argument("--voxelize", help="prefix for uint8 volumes of the fitted field (one file per channel)")
    args = ap.parse_args()

    nx, ny, nz = args.dims
    shape = (nz, ny, nx)
    s = args.spacing
    sigma = args.sigma_ratio * s
    shifted = not args.no_shift
    paths = list(args.classes) + ([args.raw] if args.raw else [])
    if not 1 <= len(paths) <= 4:
        raise SystemExit("between one and four channels are supported")
    t0 = time.time()
    data = [np.fromfile(p, dtype=np.uint8).reshape(shape).astype(np.float32) / 255.0 for p in paths]
    n_class = len(args.classes)

    offsets, values = lattice_stencil(s, sigma, args.cutoff_sigma, shifted)
    lattice_shape = tuple(int(np.ceil(n / s)) for n in shape)
    print(f"lattice {lattice_shape[::-1]} (x, y, z), spacing {s} voxels, sigma {sigma:.2f} voxels, {len(values)} voxels per kernel")

    # Occupied voxels: any class above the support value, grown by one kernel radius.
    from scipy import ndimage
    occupied = np.zeros(shape, dtype=bool)
    for c in range(n_class):
        occupied |= data[c] > args.support
    grow = int(np.ceil(args.cutoff_sigma * sigma))
    occupied_grown = ndimage.binary_dilation(occupied, iterations=grow)
    if args.raw:
        # The tomogram is only needed where a class can be visible.
        data[-1] = data[-1] * occupied_grown

    # Active nodes: those whose kernel reaches an occupied voxel.
    reach_count = adjoint(occupied.astype(np.float32), offsets, values, s, lattice_shape)
    mask = (reach_count > 1e-3).astype(np.float32)
    print(f"occupied voxels {occupied.mean() * 100:.2f} %, active lattice nodes {int(mask.sum())} of {mask.size}")

    g, reach = normal_stencil(offsets, values, s)
    g_full = np.zeros(lattice_shape, dtype=np.float64)
    for mz in range(-reach, reach + 1):
        for my in range(-reach, reach + 1):
            for mx in range(-reach, reach + 1):
                g_full[mz % lattice_shape[0], my % lattice_shape[1], mx % lattice_shape[2]] += g[mz + reach, my + reach, mx + reach]
    g_hat = np.fft.rfftn(g_full).real
    lipschitz = float(g_hat.max())
    print(f"normal operator: condition estimate {lipschitz / max(g_hat.min(), 1e-12):.1f}")

    weights = []
    for c, d in enumerate(data):
        name = (args.names[c] if args.names and c < len(args.names) else f"channel{c}")
        rhs = adjoint(d, offsets, values, s, lattice_shape) * mask
        w = fit_channel(rhs, mask, g_hat, lipschitz, args.iterations, True, name)
        weights.append(w)
        print(f"  {name}: fitted, max weight {w.max():.3f}, {time.time() - t0:.0f} s elapsed")

    w_all = np.stack(weights, axis=-1)  # (lz, ly, lx, C)
    keep = (w_all[..., :max(n_class, 1)].max(axis=-1) > args.prune) & (mask > 0)
    iz, iy, ix = np.nonzero(keep)
    means = np.stack([(ix + 0.5) * s, (iy + 0.5) * s, (iz + 0.5) * s], axis=1).astype(np.float32)
    n = means.shape[0]
    scales = np.full((n, 3), sigma, dtype=np.float32)
    quats = np.zeros((n, 4), dtype=np.float32)
    quats[:, 0] = 1.0
    w_kept = w_all[keep].astype(np.float32)
    names = list(args.names) if args.names else [f"channel{c}" for c in range(len(paths))]

    # Report the fit error of the kept Gaussians and optionally write their voxelisation.
    stats = {}
    for c, d in enumerate(data):
        lat = np.zeros(lattice_shape, dtype=np.float32)
        lat[keep] = w_kept[:, c]
        vox = forward(lat, offsets, values, s, shape)
        ref = d
        region = occupied if c < n_class or not args.raw else occupied
        rmse_all = float(np.sqrt(np.mean((vox - ref) ** 2)))
        rmse_occ = float(np.sqrt(np.mean((vox[region] - ref[region]) ** 2)))
        stats[names[c]] = {"rmse": rmse_all, "rmseOccupied": rmse_occ, "maxValue": float(vox.max())}
        print(f"  {names[c]}: RMSE {rmse_all:.4f} over the volume, {rmse_occ:.4f} inside occupied voxels (values in [0, 1])")
        if args.voxelize:
            np.clip(np.rint(vox * 255.0), 0, 255).astype(np.uint8).tofile(f"{args.voxelize}_{names[c]}.raw")

    header = write_scene(args.out, means, scales, quats, w_kept, (nx, ny, nz), names,
                         args.cutoff_sigma, shifted,
                         extra={"method": "lattice-nnls", "spacing": s, "sigma": sigma, "support": args.support,
                                "prune": args.prune, "error": stats})
    print(f"wrote {header['count']} Gaussians to {args.out} in {time.time() - t0:.0f} s")


if __name__ == "__main__":
    main()

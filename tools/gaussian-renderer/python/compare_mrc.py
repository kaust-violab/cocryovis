"""Compares a Gaussian scene with a density map (MRC) on the map's own grid.

  compare_mrc.py <scene.json> <map.mrc> [--map-max 11.87] [--scene-voxel-size 1.23]

Prints the MRC header, evaluates channel 0 of the scene at the voxel centres of the map (the
renderer kernel, as voxelize.py), and reports what decides whether the conversion is right:
- correlation and slope against map / map-max (scale and units),
- the shift between the two fields from their cross-correlation, to a fraction of a voxel (origin),
- the correlation for the six axis orders (axis order: the identity must win).
The scene's voxel size comes from its header (fit.voxelSizeA, written by convert_cryosharp.py).
"""
import argparse
import itertools

import numpy as np
from scipy import fft as sfft

from gaussian_io import read_scene
from voxelize import voxelize

MRC_MODES = {0: "i1", 1: "<i2", 2: "<f4", 6: "<u2", 12: "<f2"}


def read_mrc(path):
    """MRC2014: 1024-byte header (+ extended header), then the data with columns fastest.
    Returns the header values and the map as an array indexed [z, y, x] (x fastest)."""
    with open(path, "rb") as f:
        raw = f.read(1024)
    i32 = np.frombuffer(raw, dtype="<i4")
    f32 = np.frombuffer(raw, dtype="<f4")
    if raw[208:212] != b"MAP ":
        print(f"warning: no 'MAP ' tag in {path}, reading it as MRC anyway")
    n_crs = i32[0:3]                    # columns, rows, sections
    mode = int(i32[3])
    start_crs = i32[4:7]
    m_xyz = i32[7:10]                   # sampling along X, Y, Z
    cell_xyz = f32[10:13]               # cell size in angstrom
    axis_crs = i32[16:19]               # which axis (1 = X, 2 = Y, 3 = Z) the columns, rows, sections are
    nsymbt = int(i32[23])
    labels = [raw[224 + 80 * k:304 + 80 * k].decode("ascii", "replace").strip() for k in range(int(i32[55]))]
    h = {
        "size_crs": n_crs.tolist(), "mode": mode, "start_crs": start_crs.tolist(), "axes_crs": axis_crs.tolist(),
        "voxel_xyz": (cell_xyz / m_xyz).tolist(), "origin_xyz": f32[49:52].tolist(),
        "dmin_dmax_dmean": f32[19:22].tolist(), "rms": float(f32[54]), "labels": labels,
    }
    if mode not in MRC_MODES:
        raise SystemExit(f"{path}: MRC mode {mode} not supported")
    nc, nr, ns = (int(v) for v in n_crs)
    data = np.fromfile(path, dtype=MRC_MODES[mode], count=nc * nr * ns, offset=1024 + nsymbt)
    data = data.reshape(ns, nr, nc).astype(np.float32)       # axes: sections, rows, columns
    # reorder to [z, y, x]: for Z, Y, X find which file axis holds it
    file_axes = [int(axis_crs[2]), int(axis_crs[1]), int(axis_crs[0])]  # axis held by file axis 0, 1, 2
    vol = np.ascontiguousarray(data.transpose([file_axes.index(a) for a in (3, 2, 1)]))
    start_xyz = np.zeros(3)
    for k in range(3):
        start_xyz[int(axis_crs[k]) - 1] = start_crs[k]
    h["start_xyz"] = start_xyz.tolist()
    return h, vol


def subvoxel_shift(a, b):
    """Shift s (per axis, in voxels) with a(x) ~ b(x - s), from the peak of the cross-correlation
    refined with a parabola through its two neighbours."""
    cc = sfft.irfftn(sfft.rfftn(a) * np.conj(sfft.rfftn(b)), s=a.shape)
    peak = np.unravel_index(int(np.argmax(cc)), cc.shape)
    shift = []
    for ax, n in enumerate(cc.shape):
        lo, hi = list(peak), list(peak)
        lo[ax], hi[ax] = (peak[ax] - 1) % n, (peak[ax] + 1) % n
        y0, y1, y2 = cc[tuple(lo)], cc[peak], cc[tuple(hi)]
        d = y0 - 2 * y1 + y2
        s = peak[ax] + (0.5 * (y0 - y2) / d if d != 0 else 0.0)
        shift.append(s - n if s > n / 2 else s)
    return shift


def corr(a, b):
    a = a - a.mean()
    b = b - b.mean()
    return float(np.sum(a * b) / np.sqrt(np.sum(a * a) * np.sum(b * b)))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("scene")
    ap.add_argument("mrc")
    ap.add_argument("--map-max", type=float, default=11.87, help="the scene weights were divided by this")
    ap.add_argument("--scene-voxel-size", type=float, help="angstrom per scene voxel (default: from the header)")
    args = ap.parse_args()

    h, m = read_mrc(args.mrc)
    print("MRC header:")
    for k, v in h.items():
        print(f"  {k}: {v}")
    nz, ny, nx = m.shape
    print(f"  map as [z, y, x]: {m.shape}, min {m.min():.4g}, max {m.max():.4g}, mean {m.mean():.4g}")

    header, data = read_scene(args.scene)
    vs_scene = args.scene_voxel_size or header.get("fit", {}).get("voxelSizeA")
    if not vs_scene:
        raise SystemExit("scene voxel size unknown: pass --scene-voxel-size")
    vs_map = np.asarray(h["voxel_xyz"], dtype=np.float64)
    origin = np.asarray(h["origin_xyz"], dtype=np.float64)
    start = np.asarray(h["start_xyz"], dtype=np.float64)

    # scene voxel coordinates -> angstrom (voxel i of the scene has its centre at i * vs, i.e. at coordinate i + 0.5)
    # -> map voxel coordinates (voxel j of the map has its centre at origin + (start + j) * vs_map)
    means_a = (data[:, 0:3].astype(np.float64) - 0.5) * vs_scene
    d = data.copy()
    d[:, 0:3] = (means_a - origin) / vs_map - start + 0.5
    d[:, 3:6] = data[:, 3:6] * vs_scene / vs_map       # isotropic map voxels assumed for the scales
    one = dict(header, channels=header["channels"][:1], volumeSize={"x": nx, "y": ny, "z": nz})
    print(f"\nevaluating channel 0 of {header['count']} Gaussians on the {nx} x {ny} x {nz} map grid…")
    g = voxelize(one, d)[0]

    mn = m / args.map_max
    mask = mn > 0.1
    print(f"\nscene field: max {g.max():.4f}, mean {g.mean():.5f} | map / {args.map_max}: max {mn.max():.4f}, mean {mn.mean():.5f}")
    print(f"correlation: all voxels {corr(g, mn):.5f}, where map/max > 0.1 ({int(mask.sum())} voxels) {corr(g[mask], mn[mask]):.5f}")
    slope = float(np.dot(g[mask], mn[mask]) / np.dot(mn[mask], mn[mask]))
    rms = float(np.sqrt(np.mean((g[mask] - mn[mask]) ** 2)))
    print(f"scale: scene ~ {slope:.4f} x map (1 = same units); rms difference there {rms:.4f}")
    sz, sy, sx = subvoxel_shift(g, mn)
    print(f"shift of the scene against the map (voxels): x {sx:+.3f}, y {sy:+.3f}, z {sz:+.3f}  (0 = aligned)")
    if nx == ny == nz:
        print("axis order (correlation, scene axes relabelled; 'x y z' must win):")
        res = []
        for perm in itertools.permutations(range(3)):
            res.append((corr(np.transpose(g, perm), mn), " ".join("zyx"[p] for p in perm[::-1])))
        for r, name in sorted(res, reverse=True):
            print(f"  {name}: {r:.5f}")


if __name__ == "__main__":
    main()
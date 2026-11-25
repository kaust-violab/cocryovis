"""CryoSHARP Gaussians (binary PLY, 3DGS style) -> Gaussian scene of the renderer.

  convert_cryosharp.py inspect <file.ply>
  convert_cryosharp.py convert <file.ply> <scene.json>

inspect: prints the PLY header and the distributions that decide the conversion
(amplitudes, standard deviations, positions, quaternion norms, peak weights).
convert: writes the scene (JSON header + .bin) with gaussian_io.write_scene, its voxelisation
(<scene>_vox_<channel>.raw, as voxelize.py) and a display preset (<scene>.display.json: ramps from
the field percentiles, cameras that frame the Gaussians) for make_scene_spec.py and the viewer.
Options --voxel-size, --size, --map-max and --amp default to the EMPIAR-10049 model.
"""
import argparse
import os
import sys
import json

import numpy as np

from gaussian_io import write_scene
from voxelize import voxelize

# defaults from the CryoSHARP export of EMPIAR-10049 (README): voxel size in angstrom,
# map size in voxels and the maximum of the density map; main() replaces them with the options
VOXEL_A = 1.23
VOLUME = 192
MAP_MAX = 11.87

PLY_TYPES = {
    "char": "i1", "int8": "i1", "uchar": "u1", "uint8": "u1",
    "short": "<i2", "int16": "<i2", "ushort": "<u2", "uint16": "<u2",
    "int": "<i4", "int32": "<i4", "uint": "<u4", "uint32": "<u4",
    "float": "<f4", "float32": "<f4", "double": "<f8", "float64": "<f8",
}


def read_ply(path):
    """Reads a binary little-endian PLY with one element (the Gaussians).
    Returns the header lines and a numpy structured array, one field per property."""
    with open(path, "rb") as f:
        lines = []
        while True:
            line = f.readline()
            if not line:
                sys.exit(f"{path}: no end_header, not a PLY file")
            line = line.decode("ascii", errors="replace").strip()
            lines.append(line)
            if line == "end_header":
                break
        offset = f.tell()
    if lines[0] != "ply":
        sys.exit(f"{path}: does not start with 'ply'")
    if "format binary_little_endian 1.0" not in lines:
        sys.exit(f"{path}: only binary_little_endian is supported, header says {lines[1]}")
    elements = [l.split() for l in lines if l.startswith("element ")]
    if len(elements) != 1:
        sys.exit(f"{path}: expected one element, found {len(elements)}")
    count = int(elements[0][2])
    fields = []
    for l in lines:
        p = l.split()
        if p[0] == "property":
            if p[1] == "list":
                sys.exit(f"{path}: list properties are not supported ({l})")
            fields.append((p[2], PLY_TYPES[p[1]]))
    data = np.fromfile(path, dtype=np.dtype(fields), count=count, offset=offset)
    if data.shape[0] != count:
        sys.exit(f"{path}: header says {count} rows, file has {data.shape[0]}")
    return lines, data


def stats(name, v, unit=""):
    q = np.percentile(v, [0, 1, 25, 50, 75, 99, 100])
    print(f"  {name:<22} min {q[0]:.4g}  p1 {q[1]:.4g}  p25 {q[2]:.4g}  median {q[3]:.4g}"
          f"  p75 {q[4]:.4g}  p99 {q[5]:.4g}  max {q[6]:.4g} {unit}")


def inspect(path, amp_name):
    lines, d = read_ply(path)
    print("header:")
    for l in lines:
        print("  " + l)
    names = d.dtype.names
    n = d.shape[0]
    print(f"\n{n} Gaussians, {len(names)} properties")

    if amp_name not in names:
        sys.exit(f"no property '{amp_name}'; use --amp with one of: {', '.join(names)}")
    a = d[amp_name].astype(np.float64)
    print(f"\namplitude ('{amp_name}'):")
    print(f"  negative {np.sum(a < 0)} ({100 * np.mean(a < 0):.2f} %), zero {np.sum(a == 0)}, positive {np.sum(a > 0)}")
    stats("amplitude", a)
    if np.any(a < 0):
        stats("negative amplitudes", a[a < 0])

    s_a = np.exp(np.stack([d[f"scale_{k}"] for k in range(3)], axis=1).astype(np.float64))  # sigma in angstrom
    s_v = s_a / VOXEL_A  # sigma in voxels
    print("\nstandard deviations in voxels (exp(scale) / 1.23):")
    for k in range(3):
        stats(f"sigma_{k}", s_v[:, k], "vox")
    stats("largest sigma", s_v.max(axis=1), "vox")
    stats("anisotropy max/min", s_v.max(axis=1) / s_v.min(axis=1))
    for t in (0.5, 1, 2, 4, 8):
        print(f"  largest sigma > {t:>3} vox: {np.sum(s_v.max(axis=1) > t)}")

    c = np.stack([d["x"], d["y"], d["z"]], axis=1).astype(np.float64) / VOXEL_A + 0.5
    print("\ncentres in voxels (x / 1.23 + 0.5), volume 0 to", VOLUME, ":")
    for k, axis in enumerate("xyz"):
        stats(axis, c[:, k], "vox")
    print(f"  outside [0, {VOLUME}): {np.sum(np.any((c < 0) | (c >= VOLUME), axis=1))}")

    qn = np.linalg.norm(np.stack([d[f"rot_{k}"] for k in range(4)], axis=1).astype(np.float64), axis=1)
    print("\nquaternion norm (rot_0..3):")
    stats("|q|", qn)

    peak = a / ((2 * np.pi) ** 1.5 * np.prod(s_a, axis=1)) / MAP_MAX
    print("\npeak weight = amplitude / ((2 pi)^1.5 s1 s2 s3 [A]) / 11.87:")
    stats("weight", peak)
    print(f"  above 1 (would be clipped by the renderer if alone): {np.sum(peak > 1)}, below 0: {np.sum(peak < 0)}")


def require(d, names):
    """Stops with a clear message if a property the conversion needs is missing."""
    missing = [n for n in names if n not in d.dtype.names]
    if missing:
        sys.exit(f"missing properties: {', '.join(missing)}; the file has: {', '.join(d.dtype.names)}")


def convert(path, out_json, amp_name, write_voxels=True):
    _, d = read_ply(path)
    scale_names = [f"scale_{k}" for k in range(3)]
    rot_names = [f"rot_{k}" for k in range(4)]
    require(d, ["x", "y", "z", amp_name] + scale_names + rot_names)

    # centre: angstrom from the box corner -> continuous voxel coordinates (voxel i has its centre at i + 0.5)
    means = np.stack([d["x"], d["y"], d["z"]], axis=1).astype(np.float64) / VOXEL_A + 0.5
    # standard deviations: log of angstrom -> angstrom -> voxels
    sigma_a = np.exp(np.stack([d[n] for n in scale_names], axis=1).astype(np.float64))
    scales = sigma_a / VOXEL_A
    # quaternion (w, x, y, z): the same order as gaussian_io and gaussianScene.ts
    quats = np.stack([d[n] for n in rot_names], axis=1).astype(np.float64)
    # amplitude = integrated density; the renderer kernel has peak 1, so the weight is the peak density
    # A / ((2 pi)^1.5 s1 s2 s3) in map units, divided by the map maximum so that the field lands in 0..1
    amp = d[amp_name].astype(np.float64)
    peak = amp / ((2 * np.pi) ** 1.5 * np.prod(sigma_a, axis=1)) / MAP_MAX
    if np.any(peak < 0):
        print(f"warning: {np.sum(peak < 0)} negative weights, kept as they are")

    # tested 4-channel layout: density as class channel 0 and as raw channel 3, channels 1 and 2 empty
    weights = np.zeros((len(peak), 4))
    weights[:, 0] = peak
    weights[:, 3] = peak
    channels = ["Density", "Empty1", "Empty2", "Raw"]
    header = write_scene(out_json, means, scales, quats, weights, (VOLUME, VOLUME, VOLUME), channels,
                         extra={"source": "CryoSHARP PLY", "ply": os.path.basename(path), "voxelSizeA": VOXEL_A,
                                "mapMax": MAP_MAX, "weight": "amplitude / ((2 pi)^1.5 s1 s2 s3 [A]) / mapMax"})
    print(f"wrote {header['count']} Gaussians: {out_json} and {header['file']}")
    print(f"volume {VOLUME}^3, weights {peak.min():.4g} to {peak.max():.4g}, sigma {scales.min():.3g} to {scales.max():.3g} vox")
    
    # voxelisation with the renderer kernel (as voxelize.py), for the voxel field and the field statistics
    folder, scene = os.path.dirname(out_json), os.path.splitext(os.path.basename(out_json))[0]
    print("voxelising (about a minute)…")
    data = np.zeros((len(peak), 14), dtype=np.float32)
    data[:, 0:3], data[:, 3:6], data[:, 6:10], data[:, 10:14] = means, scales, quats, weights
    vol = voxelize(header, data)
    if write_voxels:
        for c, name in enumerate(channels):
            np.clip(np.rint(vol[c] * 255.0), 0, 255).astype(np.uint8).tofile(os.path.join(folder, f"{scene}_vox_{name}.raw"))
    print(f"field: max {vol[0].max():.3f}, voxels > 1: {int((vol[0] > 1).sum())}, visible (> 0.1): {int((vol[0] > 0.1).sum())}")

    # display preset: everything a viewer or a spec needs to show this scene, computed from the data
    ramps, percentiles = density_ramps(vol[0])
    preset = {"scene": scene, "dims": [VOLUME] * 3, "channels": channels, "numChannels": 4, "rawVolumeChannel": 3,
              "voxels": f"{scene}_vox" if write_voxels else None, "ramps": ramps, "defaultRamps": "r2",
              "cameras": framing_cameras(means, [VOLUME] * 3), "defaultCamera": "angled",
              "fieldPercentiles": percentiles}
    preset_path = os.path.join(folder, f"{scene}.display.json")
    with open(preset_path, "w") as f:
        json.dump(preset, f, indent=1)
    print(f"wrote {scene}_vox_*.raw and {preset_path}" if write_voxels else f"wrote {preset_path} (no voxel files)")
    print("ramps (low-high): " + ", ".join(f"{k} {r[0]['low']}-{r[0]['high']}" for k, r in ramps.items()))

def density_ramps(field, color="#e8b04a"):
    """Three ramp options for a density channel, from the percentiles of the visible field
    (> 0.1, the raw threshold of the shader): r1 envelope, r2 main body (default), r3 dense cores."""
    visible = field[field > 0.1]
    p = np.percentile(visible, [25, 55, 80, 85, 96])
    bounds = {"r1": (p[0], p[1]), "r2": (p[1], p[3]), "r3": (p[2], p[4])}
    # channels 1 and 2 are empty (weight 0): a ramp from 0.9 never shows; channel 3 is raw (only scales opacity)
    rest = [{"low": 0.9, "high": 1.0, "color": "#000000"}, {"low": 0.9, "high": 1.0, "color": "#000000"},
            {"low": 0.0, "high": 1.0, "color": "#ffffff"}]
    ramps = {k: [{"low": round(float(lo), 3), "high": round(float(hi), 3), "color": color}] + rest
             for k, (lo, hi) in bounds.items()}
    return ramps, {f"p{q}": round(float(v), 3) for q, v in zip((25, 55, 80, 85, 96), p)}


def framing_cameras(means, size, fov_y=40.0):
    """Two cameras that frame the Gaussian centres (1st to 99th percentile box), in the world space of the
    renderer: the volume box centred at the origin with half-size ratio = size / largest size."""
    size = np.asarray(size, dtype=np.float64)
    ratio = size / size.max()
    lo, hi = np.percentile(means, 1, axis=0), np.percentile(means, 99, axis=0)
    lo_w, hi_w = (lo / size * 2 - 1) * ratio, (hi / size * 2 - 1) * ratio
    centre = (lo_w + hi_w) / 2
    radius = np.linalg.norm(hi_w - lo_w) / 2
    dist = 1.05 * radius / np.sin(np.radians(fov_y / 2))  # the bounding sphere fits in the view
    cams = {}
    for name, d in {"angled": (1.3, 0.9, -1.8), "front": (0.0, 0.0, -1.0)}.items():
        d = np.asarray(d) / np.linalg.norm(d)
        cams[name] = {"position": [round(float(x), 3) for x in centre + d * dist],
                      "viewCenter": [round(float(x), 3) for x in centre], "up": [0, 1, 0], "fovY": fov_y}
    return cams

def main():
    # inspect() and convert() read these module settings; the options below replace them
    global VOXEL_A, VOLUME, MAP_MAX

    # options shared by both commands, with the EMPIAR-10049 values as defaults
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--amp", default="amplitude", help="name of the amplitude property")
    common.add_argument("--voxel-size", type=float, default=VOXEL_A, help="angstrom per voxel")
    common.add_argument("--size", type=int, default=VOLUME, help="voxels per side of the box")
    common.add_argument("--map-max", type=float, default=MAP_MAX, help="maximum of the density map")

    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("inspect", parents=[common])
    p.add_argument("ply")
    p = sub.add_parser("convert", parents=[common])
    p.add_argument("ply")
    p.add_argument("out", help="scene header to write (.json); the .bin goes next to it")
    p.add_argument("--no-voxels", action="store_true",
                  help="do not write the voxelisation (.raw files); the field is still computed for the preset")
    args = ap.parse_args()

    VOXEL_A, VOLUME, MAP_MAX = args.voxel_size, args.size, args.map_max

    if args.cmd == "inspect":
        inspect(args.ply, args.amp)
    else:
        convert(args.ply, args.out, args.amp, not args.no_voxels)

if __name__ == "__main__":
    main()
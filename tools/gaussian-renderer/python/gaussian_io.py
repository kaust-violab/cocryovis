"""Reading and writing the Gaussian scene files used by the Gaussian volume pass.

A scene is a JSON header plus a little-endian float32 binary with 14 values per
Gaussian: mean (x, y, z), scale (three standard deviations along the principal
axes), rotation quaternion (w, x, y, z) and up to four channel weights.
Coordinates are continuous voxel coordinates of ``volumeSize``: voxel ``i``
covers ``[i, i + 1)`` and has its centre at ``i + 0.5``.
"""
import json
import os

import numpy as np

FLOATS_PER_GAUSSIAN = 14


def write_scene(path_json, means, scales, quats, weights, volume_size, channels,
                cutoff_sigma=3.0, shifted=True, extra=None):
    n = means.shape[0]
    data = np.zeros((n, FLOATS_PER_GAUSSIAN), dtype="<f4")
    data[:, 0:3] = means
    data[:, 3:6] = scales
    data[:, 6:10] = quats
    data[:, 10:10 + weights.shape[1]] = weights
    bin_name = os.path.splitext(os.path.basename(path_json))[0] + ".bin"
    data.tofile(os.path.join(os.path.dirname(path_json), bin_name))
    header = {
        "format": "cocryovis-gaussians",
        "version": 1,
        "file": bin_name,
        "count": int(n),
        "layout": "mean3_scale3_quat4_weights4",
        "space": "voxel",
        "volumeSize": {"x": int(volume_size[0]), "y": int(volume_size[1]), "z": int(volume_size[2])},
        "channels": list(channels),
        "kernel": {"cutoffSigma": float(cutoff_sigma), "shifted": bool(shifted)},
    }
    if extra:
        header["fit"] = extra
    with open(path_json, "w") as f:
        json.dump(header, f, indent=2)
    return header


def read_scene(path_json):
    with open(path_json) as f:
        header = json.load(f)
    data = np.fromfile(os.path.join(os.path.dirname(path_json), header["file"]), dtype="<f4")
    data = data.reshape(header["count"], FLOATS_PER_GAUSSIAN)
    return header, data


def kernel_value(q, cutoff_sigma=3.0, shifted=True):
    """The kernel the renderer evaluates: a Gaussian of the squared Mahalanobis
    distance ``q``, cut at ``cutoff_sigma`` and, if ``shifted``, lowered and
    rescaled so that it reaches zero continuously at the cut."""
    qc = cutoff_sigma * cutoff_sigma
    shift = np.exp(-0.5 * qc) if shifted else 0.0
    k = (np.exp(-0.5 * q) - shift) / (1.0 - shift)
    return np.where(q < qc, k, 0.0)

"""Writes a jobs/run.mjs specification for one scene from its display preset.

  make_scene_spec.py <scene.display.json> [--size 512] [--out specs]

One reference render per ramp option, the voxelisation (if the preset names one), the fast look,
plain splats and the other cameras, all with the default ramps and camera of the preset.
"""
import argparse
import json
import os


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("preset")
    ap.add_argument("--size", type=int, default=512)
    ap.add_argument("--out", default="specs", help="folder for the specification")
    args = ap.parse_args()
    with open(args.preset) as f:
        p = json.load(f)

    name, ramps, cams = p["scene"], p["ramps"], p["cameras"]
    r0, c0 = p["defaultRamps"], p["defaultCamera"]
    march = {"scene": name, "renderer": "march", "field": "gaussian"}
    renders = []
    for key, r in ramps.items():  # the default ramps come from the spec; the others per render
        renders.append({"name": f"GM_ref_{key}", **march, "look": "reference", "camera": cams[c0],
                        **({} if key == r0 else {"ramps": r})})
    if p.get("voxels"):  # run.mjs reads <volume>_vox_<channel>.raw, so the volume is the scene name
        renders.append({"name": f"VG_ref_{r0}", "volume": name, "renderer": "march", "field": "voxel",
                        "look": "reference", "camera": cams[c0]})
    renders.append({"name": f"GM_fast_{r0}", **march, "look": "fast", "camera": cams[c0]})
    renders.append({"name": f"GSp_ref_{r0}", "scene": name, "renderer": "splat", "refitSamples": 0,
                    "look": "reference", "camera": cams[c0]})
    for cname, cam in cams.items():
        if cname != c0:
            renders.append({"name": f"GM_ref_{r0}_{cname}", **march, "look": "reference", "camera": cam})

    spec = {"name": name, "size": args.size, "dims": p["dims"], "channels": p["channels"],
            "defaults": {"numChannels": p["numChannels"], "rawVolumeChannel": p["rawVolumeChannel"]},
            "ramps": ramps[r0], "renders": renders}
    os.makedirs(args.out, exist_ok=True)
    path = os.path.join(args.out, f"{name}.json")
    with open(path, "w") as f:
        json.dump(spec, f, indent=1)
    print(f"{path}: {len(renders)} renders")


if __name__ == "__main__":
    main()
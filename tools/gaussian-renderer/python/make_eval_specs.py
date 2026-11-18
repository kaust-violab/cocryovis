"""Write a batch specification for jobs/run.mjs that renders all variants of one scene.

  make_eval_specs.py <scene> <fast|reference> <close|whole> [variants] [size] [specDir]

Variants: V0 voxel data, VG voxels of the Gaussians, GM marched, GC marched with cached
lighting, GSr re-fitted splats, GSp plain splats.
"""
import json, os, sys
CAM = {
  "close": {"position": [0.9, 0.35, -1.25], "viewCenter": [0.05, 0.0, 0.1], "up": [0, 1, 0], "fovY": 40},
  "whole": {"position": [0.25, 0.5, -1.9], "viewCenter": [0, 0, 0.05], "up": [0, 1, 0], "fovY": 45},
}
def spec(scene, look, cam, size=384, variants=("V0","VG","GM","GC","GSr","GSp")):
    tag = f"{scene}_{look}_{cam}"
    base = {"look": look, "camera": CAM[cam]}
    r = []
    if "V0" in variants: r.append({"name": f"V0_{look}_{cam}", "volume": "original", "renderer": "march", "field": "voxel", **base})
    if "VG" in variants: r.append({"name": f"VG_{tag}", "volume": scene, "renderer": "march", "field": "voxel", **base})
    if "GM" in variants: r.append({"name": f"GM_{tag}", "scene": scene, "renderer": "march", "field": "gaussian", **base})
    if "GC" in variants: r.append({"name": f"GC_{tag}", "scene": scene, "renderer": "march", "field": "gaussian", "lighting": "cached", **base})
    if "GSr" in variants: r.append({"name": f"GSr_{tag}", "scene": scene, "renderer": "splat", **base})
    if "GSp" in variants: r.append({"name": f"GSp_{tag}", "scene": scene, "renderer": "splat", "refitSamples": 0, **base})
    return {"name": f"eval_{tag}", "size": size, "renders": r}
if __name__ == "__main__":
    scene, look, cam = sys.argv[1:4]
    variants = tuple(sys.argv[4].split(",")) if len(sys.argv) > 4 else ("V0","VG","GM","GC","GSr","GSp")
    size = int(sys.argv[5]) if len(sys.argv) > 5 else 384
    spec_dir = sys.argv[6] if len(sys.argv) > 6 else "specs"
    s = spec(scene, look, cam, size, variants)
    os.makedirs(spec_dir, exist_ok=True)
    path = os.path.join(spec_dir, f"{s['name']}.json")
    json.dump(s, open(path, "w"), indent=1)
    print(path)

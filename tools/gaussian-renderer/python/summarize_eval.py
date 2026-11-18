"""Tabulate image metrics and timings of an evaluation run.

  summarize_eval.py <evalDir> <scenesDir>

Expects the images written by jobs/run.mjs for the specifications of make_eval_specs.py.
"""
import json, os, sys, glob
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from compare_images import load, metrics
E = sys.argv[1] if len(sys.argv) > 1 else 'out'
SCENES = sys.argv[2] if len(sys.argv) > 2 else 'scenes'
timings = {}
for f in glob.glob(E + '/eval_*.timings.json'):
    for r in json.load(open(f)):
        timings[r['name']] = r
counts = {s: json.load(open(f'{SCENES}/{s}.json'))['count'] for s in ('ts16_s2', 'ts16_s3', 'ts16_s4') if os.path.exists(f'{SCENES}/{s}.json')}
rows = []
combos = [('ts16_s2','fast','close'),('ts16_s2','fast','whole'),('ts16_s2','reference','close'),('ts16_s2','reference','whole'),('ts16_s3','reference','close'),('ts16_s4','reference','close')]
names = {'VG':'voxels of the Gaussians','GM':'marched','GC':'marched, cached light','GSr':'splats, re-fitted','GSp':'splats, plain'}
for scene, look, cam in combos:
    tag = f'{scene}_{look}_{cam}'
    if not (os.path.exists(f'{E}/V0_{look}_{cam}.png') and os.path.exists(f'{E}/VG_{tag}.png')):
        continue
    v0 = load(f'{E}/V0_{look}_{cam}.png'); vg = load(f'{E}/VG_{tag}.png')
    for v in ('VG','GM','GC','GSr','GSp'):
        p = f'{E}/{v}_{tag}.png'
        if not os.path.exists(p): continue
        img = load(p)
        row = {'scene': scene, 'gaussians': counts[scene], 'look': look, 'camera': cam, 'variant': v, 'label': names[v],
               'ms': timings.get(f'{v}_{tag}', {}).get('ms'), 'extra': timings.get(f'{v}_{tag}', {}).get('extra')}
        if v != 'VG':
            a = metrics(vg, img); b = metrics(vg, img, 1.5)
            row.update(psnr_vsVG=a['psnr'], ssim_vsVG=a['ssim'], psnrBlur_vsVG=b['psnr'], ssimBlur_vsVG=b['ssim'])
        a = metrics(v0, img); b = metrics(v0, img, 1.5)
        row.update(psnr_vsV0=a['psnr'], ssim_vsV0=a['ssim'], psnrBlur_vsV0=b['psnr'], ssimBlur_vsV0=b['ssim'])
        rows.append(row)
    rows.append({'scene': scene, 'look': look, 'camera': cam, 'variant': 'V0', 'label': 'voxel data', 'ms': timings.get(f'V0_{look}_{cam}', {}).get('ms')})
json.dump(rows, open(E + '/summary.json', 'w'), indent=1)
f = lambda x, d=1: '-' if x is None else (f'{x:.{d}f}')
print('| scene | look | camera | variant | vs voxels of same Gaussians: PSNR / SSIM (after 1.5 px blur) | vs voxel data: PSNR / SSIM (blurred) | software ms |')
print('|---|---|---|---|---|---|---|')
for r in rows:
    if r['variant'] == 'V0':
        print(f"| {r['scene']} | {r['look']} | {r['camera']} | voxel data | | | {f(r['ms'],0)} |"); continue
    a = '-' if 'psnr_vsVG' not in r else f"{r['psnr_vsVG']:.1f} / {r['ssim_vsVG']:.3f} ({r['psnrBlur_vsVG']:.1f} / {r['ssimBlur_vsVG']:.3f})"
    b = f"{r['psnr_vsV0']:.1f} / {r['ssim_vsV0']:.3f} ({r['psnrBlur_vsV0']:.1f} / {r['ssimBlur_vsV0']:.3f})"
    print(f"| {r['scene']} ({r['gaussians']//1000}k) | {r['look']} | {r['camera']} | {r['label']} | {a} | {b} | {f(r['ms'],0)} |")

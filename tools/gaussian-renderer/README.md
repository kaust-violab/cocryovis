# Gaussian volume pass: tools and tests

Headless test harness, fitting tools and evaluation scripts for
`client/src/renderer/gaussian`. Nothing in this folder is shipped with the
client.

## Set-up

```bash
npm install                      # esbuild, gl-matrix, buffer-backed-object, type definitions
npm install -D playwright        # not in package.json yet
npx playwright install chromium
node build.mjs                   # bundles src/harness.ts with the real client renderer classes
```

By default the runner starts Chromium with software WebGPU (SwiftShader),
which runs on any machine but is slow. Every run prints the WebGPU adapter and
flags a software rasteriser. On a machine with a GPU and a display:

```bash
export GV_BROWSER_ARGS="--enable-unsafe-webgpu --enable-features=Vulkan --ignore-gpu-blocklist"
export GV_HEADLESS=0
```

On a headless Linux server, Chrome's own guidance is `--use-angle=vulkan
--enable-features=Vulkan --disable-vulkan-surface --enable-unsafe-webgpu` with
the new headless mode; check that the printed adapter is not SwiftShader.

Data: `GV_TS16_DIR` points to `data/ts_16_256` of
`github.com/kaust-violab/nano-oetzi-webgpu`, `GV_SCENES` to a folder with
Gaussian scenes, `GV_OUT` to the output folder.

## Scene format

A JSON header plus a little-endian float32 binary, 14 values per Gaussian:
mean (x, y, z), three standard deviations, rotation quaternion (w, x, y, z),
four channel weights. Coordinates are continuous voxel coordinates of
`volumeSize` (voxel `i` covers `[i, i + 1)`). The kernel is a Gaussian cut at
`cutoffSigma` standard deviations and, if `shifted`, lowered so that it
reaches zero at the cut. See `python/gaussian_io.py`.

## Python tools

| Script | Purpose |
|---|---|
| `fit_lattice.py` | Fits isotropic Gaussians on a lattice to uint8 class volumes and a tomogram by non-negative least squares; Gaussians only where the classes have support |
| `voxelize.py` | Voxelises any scene with the renderer's kernel, for the equivalence test |
| `make_test_scene.py` | Random, rotated, strongly anisotropic Gaussians |
| `compare_images.py` | PSNR, SSIM, the same after a small blur, montage with difference images |
| `make_eval_specs.py`, `summarize_eval.py` | Batch specifications and the result table |

```bash
D=$GV_TS16_DIR
python3 python/fit_lattice.py --dims 256 256 448 --spacing 2 \
  --class $D/ts_16_predictions-Spikes-256x256.raw \
  --class $D/ts_16_predictions-Membrane-256x256.raw \
  --class $D/ts_16_predictions-Inner-256x256.raw \
  --raw $D/ts_16_bin4-uint8-inv-mean-3-256x256.raw \
  --names Spikes Membrane Inner Raw \
  --out $GV_SCENES/ts16_s2.json --voxelize $GV_SCENES/ts16_s2_vox
```

## Running

```bash
node jobs/regression.mjs out 192          # voxel field must equal VolumePass exactly
python3 python/make_eval_specs.py ts16_s2 reference close
node jobs/run.mjs specs/eval_ts16_s2_reference_close.json out
python3 python/summarize_eval.py out $GV_SCENES
```

A batch specification lists renders; each names a renderer (`original`,
`march`, `splat`), a field (`voxel`, `gaussian`), a look (`fast`,
`reference`), a lighting mode (`per-sample`, `cached`), a camera and optional
`params`, `ext`, `bloom` and `refitSamples`. `volume` selects the voxel data
(`original` or the voxelisation of a scene), `scene` the Gaussian scene.

## How the comparison is set up

The reference for a Gaussian renderer is the voxel renderer applied to the
voxelisation of the same Gaussians. That separates the error of the renderer
from the error of the fit. Images also differ in sampling grain, because rays
are jittered and occlusion is sampled at random; metrics are therefore given
twice, as they are and after a 1.5 pixel blur.

Timings from the default set-up are software rasterisation on CPU cores. They
show how the cost of each variant scales, not what a GPU achieves.

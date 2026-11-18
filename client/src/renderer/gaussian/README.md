# Gaussian volume pass

Renders a scene of 3D Gaussians with the shading of the CoCryoViS volume
renderer, without converting it to voxels. Each Gaussian has a mean, an
anisotropic covariance and up to four channel weights (class probabilities and
tomogram density); the channel fields are the sums of the weighted kernels.

The passes read the same buffers as `VolumePass`: camera, transfer-function
lookup, `RenderingParametersBuffer`, `VolumeParameterBuffer`, `ChannelData`
and the clipping parameters. `ExtParametersBuffer` adds what `VolumePass` does
not have.

## Files

| File | Purpose |
|---|---|
| `gaussianScene.ts` | Loads a scene file, converts it to texture space, builds the uniform grid of Gaussian lists, owns the GPU buffers |
| `gaussianVolumePass.ts` | Ray-marching pass. Field source is either the voxel texture or a `GaussianScene` |
| `gaussianLightCache.ts` | Compute pass: ambient occlusion and shadow once per Gaussian |
| `gaussianSplatPass.ts` | Pure-splatting pass: classification and lighting per Gaussian, depth sort, alpha-blended splats |
| `bloomComposite.ts` | Replacement for `FullscreenComposite` with bloom |
| `extParametersBuffer.ts` | Look and lighting mode, constants of the reference look |
| `assets/shaders/gaussian/*.wgsl` | Shader modules, concatenated by the pass classes |

## Two looks

`ExtParameters.lookMode`:

- `LookMode.Fast`: the code of `volume.fs.wgsl`, statement for statement. With
  the voxel field the output of `GaussianVolumePass` is bit-identical to
  `VolumePass` (`tools/gaussian-renderer/jobs/regression.mjs`).
- `LookMode.Reference`: the lighting described in Nano-Oetzi (TVCG), Section
  5.2, with the constants of the desktop GLSL shader that ships inside the
  WebGPU port (`fsWBGPU.txt`): gradient-free occlusion from a sphere pushed
  upwards, soft shadows by Monte Carlo sampling of a cone towards a spherical
  light, a multiplicative shadow tint and a brightness gain. Opacity, transfer
  functions, compositing and early termination stay those of CoCryoViS, and
  the `aoRadius`, `aoStrength`, `shadowQuality` and `shadowStrength` sliders
  keep acting on it. `BloomComposite` adds the bloom.

Both looks work with the voxel field too, so `GaussianVolumePass` with
`field: { kind: "voxel" }` gives CoCryoViS the reference look for ordinary
volumes.

## Three ways to render Gaussians

1. **Marched, lighting per sample** (`GaussianVolumePass`,
   `LightingMode.PerSample`). Every ray sample sums the Gaussians of its grid
   cell and is then classified and lit exactly like a voxel sample. This is the
   variant that reproduces the voxel renderer.
2. **Marched, lighting cached** (`LightingMode.Cached`, call
   `updateLightCache()` after the camera or a transfer function changed).
   Ambient occlusion and shadow are computed once at each Gaussian centre and
   interpolated with the kernel weights. No sampling grain. Accurate only when
   the Gaussians are small compared with the structures they form.
3. **Splatted** (`GaussianSplatPass`). Each Gaussian is first re-fitted to its
   share of the classified field (`classify()`, needed when a transfer function
   changes), lit once at the point where the viewer sees it (`light()`, needed
   when the camera moves), sorted (`sort()`) and drawn as a screen-space splat.
   `options.refitSamples = 0` gives plain pre-classified splats.

## Wiring into `VolumeRenderer`

```ts
const extParameters = new ExtParametersBuffer(device, {
  lookMode: LookMode.Reference,
});
const scene = await GaussianScene.load(device, "/data/scene.json");
const size = scene.header.volumeSize;
const max = Math.max(size.x, size.y, size.z);
volumeManager.volumeParameterBuffer.set({
  ratio: [size.x / max, size.y / max, size.z / max, 1],
  numChannels: scene.header.channels.length,
  rawVolumeChannel: 3, // or -1 without a density channel
});

const pass = new GaussianVolumePass({
  device, width, height, format, camera,
  volumeManager, annotationManager, renderingParameters, clippingPlaneManager,
  extParameters,
  field: { kind: "gaussian", scene },
});
const composite = new BloomComposite(device, format, pass.framebuffer);

// per frame
const encoder = device.createCommandEncoder();
pass.render(encoder, clearColor);
composite.prepare(encoder);
const final = encoder.beginRenderPass({ /* canvas view */ });
composite.render(final);
final.end();
device.queue.submit([encoder.finish()]);
```

The transfer functions, channel visibility and render settings of the user
interface apply unchanged, because the pass reads the same buffers.

## Not done yet

- No user-interface or server wiring: loading a Gaussian scene, and switches
  for look, lighting mode and bloom, are not connected to the React client.
- The slice drawn on the clipping plane (`clipping_plane.fs.wgsl`) is not
  ported. Clipping itself works: per ray sample when marching, per fitted
  sample point when splatting.
- Annotations are read from the voxel annotation volume by the marcher and
  have not been tested with a Gaussian scene. The splat pass ignores them.
- The splat pass writes depth 0 and sorts on the main thread.
- The light cache is computed for every Gaussian and at the centre only.
- Frame rates on a GPU have not been measured; see
  `tools/gaussian-renderer/README.md`.

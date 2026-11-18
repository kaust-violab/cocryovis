// Fills the light cache: ambient occlusion and shadow at the centre of every
// Gaussian, with the lighting model selected by ext.lookMode. Shadows depend on
// the light, which follows the camera, so the cache is refilled when the camera
// or a transfer function changes.

@group(1) @binding(4)
var<storage, read_write> gaussLightCacheOut: array<vec4<f32>>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
	let i = id.x;
	if (i >= gaussGrid.count) {
		return;
	}
	let isec1 = gaussians[i].mean.xyz;
	let isec0 = texToWorld(isec1);
	let kernelSum = kernelSumAt(isec1);

	let repeats = max(ext.cacheRepeats, 1u);
	var ao = 0.0;
	var shadow = 0.0;
	if (ext.lookMode == 1u) {
		let lightPos = (camera.viewInv * vec4<f32>(ext.refLightPosView, 1.0)).xyz;
		for (var r = 0u; r < repeats; r = r + 1u) {
			seedGlobal = wang_hash(i * 747796405u + r * 2891336453u + ext.frameSeed * 26699u + 1u);
			ao = ao + aoRef(isec1);
			shadow = shadow + shadowRef(isec0, isec1, lightPos);
		}
		ao = ao / f32(repeats);
		shadow = shadow / f32(repeats);
	}
	else {
		// same light as volume.vs.wgsl
		let lightPos = (camera.viewInv * vec4<f32>(0.0, 1.0, 1.0, 1.0)).xyz;
		for (var r = 0u; r < repeats; r = r + 1u) {
			seedGlobal = wang_hash(i * 747796405u + r * 2891336453u + ext.frameSeed * 26699u + 1u);
			ao = ao + aoFast(isec1);
		}
		ao = ao / f32(repeats);
		shadow = shadowFast(isec0, isec1, lightPos);
	}
	gaussLightCacheOut[i] = vec4<f32>(ao, shadow, kernelSum, 0.0);
}

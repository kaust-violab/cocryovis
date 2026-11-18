// Read access to the per-Gaussian light cache (filled by gv_lightcache.comp.wgsl).
// x: ambient occlusion, y: shadow, z: kernel sum at the Gaussian centre.

@group(1) @binding(4)
var<storage, read> gaussLightCache: array<vec4<f32>>;

// Kernel-weighted mean of the cached lighting of the Gaussians around pos.
fn cachedLightAt(pos: vec3<f32>) -> vec2<f32> {
	let cell = gaussCellAt(pos);
	var acc = vec2<f32>(0.0);
	var total = 0.0;
	let end = cell.x + cell.y;
	for (var k = cell.x; k < end; k = k + 1u) {
		let i = gaussGridIndices[k];
		let w = gaussKernel(gaussians[i].mean.xyz, gaussians[i].ic0, gaussians[i].ic1, pos);
		if (w > 0.0) {
			acc = acc + gaussLightCache[i].xy * w;
			total = total + w;
		}
	}
	if (total <= 0.0) {
		return vec2<f32>(0.0);
	}
	return acc / total;
}

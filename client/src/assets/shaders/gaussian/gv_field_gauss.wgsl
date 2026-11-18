// Field module: the four channels are sums of 3D Gaussians, found through a
// uniform grid over the texture space [0, 1]^3 (see gaussianScene.ts).

struct GaussGrid {
	dims: vec3<u32>,
	count: u32,
	// squared Mahalanobis distance at which the kernel is cut
	cutoffQ: f32,
	// kernel = (exp(-q / 2) - kernelShift) * kernelNorm, zero at the cut
	kernelShift: f32,
	kernelNorm: f32,
	reserved: f32,
}

struct Gaussian {
	// mean in texture space
	mean: vec4<f32>,
	// inverse covariance in texture space: xx, xy, xz, yy
	ic0: vec4<f32>,
	// yz, zz, unused, unused
	ic1: vec4<f32>,
	// one weight per channel
	weights: vec4<f32>,
}

@group(1) @binding(0)
var<uniform> gaussGrid: GaussGrid;

@group(1) @binding(1)
var<storage, read> gaussians: array<Gaussian>;

// (offset, count) into gaussGridIndices for every grid cell
@group(1) @binding(2)
var<storage, read> gaussGridCells: array<vec2<u32>>;

@group(1) @binding(3)
var<storage, read> gaussGridIndices: array<u32>;

fn gaussCellAt(pos: vec3<f32>) -> vec2<u32> {
	let dims = vec3<f32>(gaussGrid.dims);
	let c = vec3<u32>(clamp(pos * dims, vec3<f32>(0.0), dims - 1.0));
	return gaussGridCells[c.x + gaussGrid.dims.x * (c.y + gaussGrid.dims.y * c.z)];
}

fn gaussKernel(mean: vec3<f32>, ic0: vec4<f32>, ic1: vec4<f32>, pos: vec3<f32>) -> f32 {
	let d = pos - mean;
	let q = d.x * (ic0.x * d.x + 2.0 * (ic0.y * d.y + ic0.z * d.z))
		+ d.y * (ic0.w * d.y + 2.0 * ic1.x * d.z)
		+ ic1.y * d.z * d.z;
	if (q >= gaussGrid.cutoffQ) {
		return 0.0;
	}
	return (exp(- 0.5 * q) - gaussGrid.kernelShift) * gaussGrid.kernelNorm;
}

fn fieldAt(pos: vec3<f32>) -> vec4<f32> {
	let cell = gaussCellAt(pos);
	var acc = vec4<f32>(0.0);
	let end = cell.x + cell.y;
	for (var k = cell.x; k < end; k = k + 1u) {
		let i = gaussGridIndices[k];
		let w = gaussKernel(gaussians[i].mean.xyz, gaussians[i].ic0, gaussians[i].ic1, pos);
		if (w > 0.0) {
			acc = acc + gaussians[i].weights * w;
		}
	}
	// the voxel renderer reads 8-bit normalised textures; keep the same range
	return clamp(acc, vec4<f32>(0.0), vec4<f32>(1.0));
}

struct FieldSample {
	// channel values, clamped like fieldAt
	value: vec4<f32>,
	// sum of the kernels alone
	kernelSum: f32,
}

// Field and kernel sum in one walk over the cell.
fn fieldSampleAt(pos: vec3<f32>) -> FieldSample {
	let cell = gaussCellAt(pos);
	var acc = vec4<f32>(0.0);
	var total = 0.0;
	let end = cell.x + cell.y;
	for (var k = cell.x; k < end; k = k + 1u) {
		let i = gaussGridIndices[k];
		let w = gaussKernel(gaussians[i].mean.xyz, gaussians[i].ic0, gaussians[i].ic1, pos);
		if (w > 0.0) {
			acc = acc + gaussians[i].weights * w;
			total = total + w;
		}
	}
	var result: FieldSample;
	result.value = clamp(acc, vec4<f32>(0.0), vec4<f32>(1.0));
	result.kernelSum = total;
	return result;
}

// Sum of the kernels alone, the normaliser of per-Gaussian quantities.
fn kernelSumAt(pos: vec3<f32>) -> f32 {
	let cell = gaussCellAt(pos);
	var acc = 0.0;
	let end = cell.x + cell.y;
	for (var k = cell.x; k < end; k = k + 1u) {
		let i = gaussGridIndices[k];
		acc = acc + gaussKernel(gaussians[i].mean.xyz, gaussians[i].ic0, gaussians[i].ic1, pos);
	}
	return acc;
}

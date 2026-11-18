// Pure-splatting variant, step 2: draw every Gaussian as a screen-space quad,
// front to back. The fragment evaluates the line integral of the 3D kernel
// along the view ray and turns it into opacity.

struct Camera {
	view: mat4x4<f32>,
	viewInv: mat4x4<f32>,
	proj: mat4x4<f32>,
	mvpInv: mat4x4<f32>,
}

struct VolumeParameters {
	rawVolumeChannel: i32,
	numChannels: i32,
	voxelSize: f32,
	rawClippingPlane: i32,
	ratio: vec4<f32>,
}

struct GaussGrid {
	dims: vec3<u32>,
	count: u32,
	cutoffQ: f32,
	kernelShift: f32,
	kernelNorm: f32,
	reserved: f32,
}

struct SplatGeometry {
	// fitted mean in texture space; w: extinction amplitude
	mean: vec4<f32>,
	// fitted covariance in texture space: xx, xy, xz, yy
	cov0: vec4<f32>,
	// yz, zz, unused, unused
	cov1: vec4<f32>,
	base: vec4<f32>,
}

struct SplatParams {
	viewport: vec2<f32>,
	reserved: vec2<f32>,
}

@group(0) @binding(0) var<uniform> camera: Camera;
@group(0) @binding(7) var<uniform> volumeParameters: VolumeParameters;

@group(1) @binding(0) var<uniform> gaussGrid: GaussGrid;
// geometry of every splat after classification (gv_splat_classify.comp.wgsl)
@group(1) @binding(1) var<storage, read> splatGeometry: array<SplatGeometry>;
// rgb: shaded colour, a: extinction amplitude per world unit (0 = invisible)
@group(1) @binding(2) var<storage, read> splatAttr: array<vec4<f32>>;
// Gaussian indices, nearest first
@group(1) @binding(3) var<storage, read> splatOrder: array<u32>;
@group(1) @binding(4) var<uniform> splatParams: SplatParams;

struct VertexOutput {
	@builtin(position) position: vec4<f32>,
	// offset from the splat centre in pixels (y up)
	@location(0) delta: vec2<f32>,
	// inverse of the 2D covariance: xx, xy, yy
	@location(1) @interpolate(flat) conic: vec3<f32>,
	@location(2) @interpolate(flat) color: vec3<f32>,
	// x: extinction amplitude, y: standard deviation of the kernel along the ray (world units)
	@location(3) @interpolate(flat) optical: vec2<f32>,
}

const corners = array<vec2<f32>, 6>(
	vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(-1.0, 1.0),
	vec2<f32>(-1.0, 1.0), vec2<f32>(1.0, -1.0), vec2<f32>(1.0, 1.0),
);

@vertex
fn vs(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) instanceIndex: u32) -> VertexOutput {
	var out: VertexOutput;
	// anything left untouched is clipped away
	out.position = vec4<f32>(0.0, 0.0, 2.0, 1.0);
	out.delta = vec2<f32>(0.0);
	out.conic = vec3<f32>(0.0);
	out.color = vec3<f32>(0.0);
	out.optical = vec2<f32>(0.0);

	let i = splatOrder[instanceIndex];
	let attr = splatAttr[i];
	if (attr.a <= 0.0) {
		return out;
	}
	let g = splatGeometry[i];
	let scale = 2.0 * volumeParameters.ratio.xyz;
	let centerWorld = (g.mean.xyz - 0.5) * scale;
	let centerView = (camera.view * vec4<f32>(centerWorld, 1.0)).xyz;
	let depth = - centerView.z;
	if (depth <= 1e-4) {
		return out;
	}

	// covariance in world space (texture space scaled per axis)
	let covWorld = mat3x3<f32>(
		vec3<f32>(g.cov0.x * scale.x * scale.x, g.cov0.y * scale.x * scale.y, g.cov0.z * scale.x * scale.z),
		vec3<f32>(g.cov0.y * scale.x * scale.y, g.cov0.w * scale.y * scale.y, g.cov1.x * scale.y * scale.z),
		vec3<f32>(g.cov0.z * scale.x * scale.z, g.cov1.x * scale.y * scale.z, g.cov1.y * scale.z * scale.z),
	);
	// its inverse (symmetric), needed for the kernel width along the ray
	let c = covWorld;
	let i00 = c[1][1] * c[2][2] - c[1][2] * c[2][1];
	let i01 = c[0][2] * c[2][1] - c[0][1] * c[2][2];
	let i02 = c[0][1] * c[1][2] - c[0][2] * c[1][1];
	let det = c[0][0] * i00 + c[1][0] * i01 + c[2][0] * i02;
	if (abs(det) < 1e-38) {
		return out;
	}
	let i11 = c[0][0] * c[2][2] - c[0][2] * c[2][0];
	let i12 = c[0][2] * c[1][0] - c[0][0] * c[1][2];
	let i22 = c[0][0] * c[1][1] - c[0][1] * c[1][0];
	let a = mat3x3<f32>(
		vec3<f32>(i00, i01, i02),
		vec3<f32>(i01, i11, i12),
		vec3<f32>(i02, i12, i22),
	) * (1.0 / det);

	let rot = mat3x3<f32>(camera.view[0].xyz, camera.view[1].xyz, camera.view[2].xyz);
	let covView = rot * covWorld * transpose(rot);

	// Jacobian of the perspective projection at the centre, in pixels
	let fx = camera.proj[0][0] * splatParams.viewport.x * 0.5;
	let fy = camera.proj[1][1] * splatParams.viewport.y * 0.5;
	let j0 = vec3<f32>(fx / depth, 0.0, fx * centerView.x / (depth * depth));
	let j1 = vec3<f32>(0.0, fy / depth, fy * centerView.y / (depth * depth));
	let sxx = dot(j0, covView * j0);
	let sxy = dot(j0, covView * j1);
	let syy = dot(j1, covView * j1);
	let det2 = sxx * syy - sxy * sxy;
	if (det2 <= 0.0) {
		return out;
	}

	// kernel width along the ray: 1 / sqrt(d^T A d) with d the world-space ray direction
	let eye = (camera.viewInv * vec4<f32>(0.0, 0.0, 0.0, 1.0)).xyz;
	let dir = normalize(centerWorld - eye);
	let sigmaRay = inverseSqrt(max(dot(dir, a * dir), 1e-30));

	let cut = sqrt(gaussGrid.cutoffQ);
	let half = vec2<f32>(cut * sqrt(sxx), cut * sqrt(syy));
	let corner = corners[vertexIndex];
	let clip = camera.proj * vec4<f32>(centerView, 1.0);
	let ndc = clip.xy / clip.w + corner * half * 2.0 / splatParams.viewport;

	out.position = vec4<f32>(ndc, 0.5, 1.0);
	out.delta = corner * half;
	out.conic = vec3<f32>(syy, - sxy, sxx) / det2;
	out.color = attr.rgb;
	out.optical = vec2<f32>(attr.a, sigmaRay);
	return out;
}

// Abramowitz and Stegun 7.1.26, absolute error below 1.5e-7.
fn erf(x: f32) -> f32 {
	let t = 1.0 / (1.0 + 0.3275911 * abs(x));
	let y = 1.0 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * exp(- x * x);
	return sign(x) * y;
}

@fragment
fn fs(in: VertexOutput) -> @location(0) vec4<f32> {
	let q = in.conic.x * in.delta.x * in.delta.x + 2.0 * in.conic.y * in.delta.x * in.delta.y + in.conic.z * in.delta.y * in.delta.y;
	if (q >= gaussGrid.cutoffQ) {
		discard;
	}
	// Integral of the cut, shifted kernel along the ray, in units of sigmaRay:
	// the ray crosses the support for |t| < l, with l^2 = cutoffQ - q.
	let l = sqrt(gaussGrid.cutoffQ - q);
	let integral = (2.50662827463 * exp(- 0.5 * q) * erf(l * 0.70710678118) - 2.0 * gaussGrid.kernelShift * l) * gaussGrid.kernelNorm;
	let opticalDepth = in.optical.x * in.optical.y * max(integral, 0.0);
	let alpha = 1.0 - exp(- opticalDepth);
	// premultiplied; blended front to back
	return vec4<f32>(in.color * alpha, alpha);
}

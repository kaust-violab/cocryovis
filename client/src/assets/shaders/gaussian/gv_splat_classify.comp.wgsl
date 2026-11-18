// Pure-splatting variant, step 1: classify every Gaussian (view independent).
//
// The transfer functions act on the summed field, which a single splat cannot
// see. So each Gaussian is re-fitted to its share of the classified field:
// the field is classified at sample points drawn from the Gaussian, exactly as
// a ray sample would be, each sample's extinction is shared among the
// overlapping kernels (division by the kernel sum), and the Gaussian is replaced
// by the one that has the same total extinction, centre of mass and second
// moments. A Gaussian that lies only partly inside a classified structure
// therefore shrinks onto the part that is inside.
//
// With sampleCount = 0 the Gaussian keeps its shape and is classified at its
// centre only (plain pre-classified splatting).

struct SplatClassifyParams {
	sampleCount: u32,
	// lower bound of the fitted covariance, as a fraction of the original one
	covarianceFloor: f32,
	reserved0: u32,
	reserved1: u32,
	// standard normal sample points (zero mean, unit covariance)
	samples: array<vec4<f32>, 32>,
}

struct SplatGeometry {
	// fitted mean in texture space; w: extinction amplitude per world unit, 0 = invisible
	mean: vec4<f32>,
	// fitted covariance in texture space: xx, xy, xz, yy
	cov0: vec4<f32>,
	// yz, zz, unused, unused
	cov1: vec4<f32>,
	// unshaded colour
	base: vec4<f32>,
}

@group(1) @binding(5)
var<storage, read_write> splatGeometryOut: array<SplatGeometry>;

@group(1) @binding(6)
var<uniform> classifyParams: SplatClassifyParams;

struct Classified {
	// opacity per world unit, summed over the classes
	extinction: f32,
	// extinction-weighted colour sum
	color: vec3<f32>,
}

// What the ray marcher would make of a sample at this point.
fn classifyAt(isec1: vec3<f32>, channels: vec4<f32>) -> Classified {
	var result: Classified;
	result.extinction = 0.0;
	result.color = vec3<f32>(0.0);

	let rawVolumeChannel = volumeParameters.rawVolumeChannel;
	let useRawVolume = rawVolumeChannel >= 0;
	let numChannels = volumeParameters.numChannels;

	if (!insideUnitCube(isec1)) {
		return result;
	}
	if (bool(clippingPlane.enabled) && isClipped(texToWorld(isec1))) {
		return result;
	}
	var masks: vec4<f32>;
	masks.x = channels.x * f32(channelData[0].visible);
	masks.y = channels.y * f32(channelData[1].visible);
	masks.z = channels.z * f32(channelData[2].visible);
	masks.w = channels.w * f32(channelData[3].visible);

	var influence = 0.0;
	for (var c: i32 = 0; c < numChannels; c = c + 1) {
		if (c != rawVolumeChannel) {
			influence += color_transfer(c, masks[c]).a;
		}
	}
	if (influence <= 0.2 || (useRawVolume && masks[rawVolumeChannel] <= 0.1)) {
		return result;
	}
	for (var which: i32 = 0; which < numChannels; which = which + 1) {
		if (which == rawVolumeChannel) {
			continue;
		}
		let tfSample = color_transfer(which, masks[which]);
		// the marcher uses alpha * step / 0.0025 per step
		var e = tfSample.a / 0.0025;
		if (useRawVolume) {
			e = e * masks[rawVolumeChannel];
		}
		result.extinction = result.extinction + e;
		result.color = result.color + tfSample.rgb * e;
	}
	return result;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
	let i = id.x;
	if (i >= gaussGrid.count) {
		return;
	}
	let g = gaussians[i];
	let mean = g.mean.xyz;

	// covariance in texture space = inverse of the stored inverse covariance
	let a00 = g.ic0.x; let a01 = g.ic0.y; let a02 = g.ic0.z;
	let a11 = g.ic0.w; let a12 = g.ic1.x; let a22 = g.ic1.y;
	let c00 = a11 * a22 - a12 * a12;
	let c01 = a02 * a12 - a01 * a22;
	let c02 = a01 * a12 - a02 * a11;
	let det = a00 * c00 + a01 * c01 + a02 * c02;
	let inv = 1.0 / det;
	let s00 = c00 * inv; let s01 = c01 * inv; let s02 = c02 * inv;
	let s11 = (a00 * a22 - a02 * a02) * inv;
	let s12 = (a01 * a02 - a00 * a12) * inv;
	let s22 = (a00 * a11 - a01 * a01) * inv;

	var out: SplatGeometry;
	out.mean = vec4<f32>(mean, 0.0);
	out.cov0 = vec4<f32>(s00, s01, s02, s11);
	out.cov1 = vec4<f32>(s12, s22, 0.0, 0.0);
	out.base = vec4<f32>(0.0);

	let n = min(classifyParams.sampleCount, 32u);
	if (n == 0u) {
		// plain pre-classified splat
		let fs = fieldSampleAt(mean);
		let cl = classifyAt(mean, fs.value);
		if (cl.extinction > 0.0) {
			out.mean.w = cl.extinction / max(fs.kernelSum, 1e-3);
			out.base = vec4<f32>(cl.color / cl.extinction, 1.0);
		}
		splatGeometryOut[i] = out;
		return;
	}

	// Cholesky factor of the covariance: sample = mean + L z
	let l00 = sqrt(max(s00, 1e-20));
	let l10 = s01 / l00;
	let l20 = s02 / l00;
	let l11 = sqrt(max(s11 - l10 * l10, 1e-20));
	let l21 = (s12 - l20 * l10) / l11;
	let l22 = sqrt(max(s22 - l20 * l20 - l21 * l21, 1e-20));

	var mass = 0.0;
	var first = vec3<f32>(0.0);
	var colorSum = vec3<f32>(0.0);
	// second moments about the original mean, in sample (z) coordinates scaled by L
	var m00 = 0.0; var m01 = 0.0; var m02 = 0.0; var m11 = 0.0; var m12 = 0.0; var m22 = 0.0;
	for (var k = 0u; k < n; k = k + 1u) {
		let z = classifyParams.samples[k].xyz;
		let d = vec3<f32>(l00 * z.x, l10 * z.x + l11 * z.y, l20 * z.x + l21 * z.y + l22 * z.z);
		let pos = mean + d;
		let fs = fieldSampleAt(pos);
		let cl = classifyAt(pos, fs.value);
		if (cl.extinction <= 0.0) {
			continue;
		}
		// this Gaussian's share of the classified field at the sample
		let w = cl.extinction / max(fs.kernelSum, 1e-3);
		mass = mass + w;
		first = first + d * w;
		colorSum = colorSum + cl.color / cl.extinction * w;
		m00 = m00 + w * d.x * d.x; m01 = m01 + w * d.x * d.y; m02 = m02 + w * d.x * d.z;
		m11 = m11 + w * d.y * d.y; m12 = m12 + w * d.y * d.z; m22 = m22 + w * d.z * d.z;
	}
	if (mass <= 0.0) {
		splatGeometryOut[i] = out;
		return;
	}
	let shift = first / mass;
	// blend towards the original covariance so that the fit cannot collapse
	let keep = clamp(classifyParams.covarianceFloor, 0.0, 1.0);
	let fit = 1.0 - keep;
	let f00 = fit * (m00 / mass - shift.x * shift.x) + keep * s00;
	let f01 = fit * (m01 / mass - shift.x * shift.y) + keep * s01;
	let f02 = fit * (m02 / mass - shift.x * shift.z) + keep * s02;
	let f11 = fit * (m11 / mass - shift.y * shift.y) + keep * s11;
	let f12 = fit * (m12 / mass - shift.y * shift.z) + keep * s12;
	let f22 = fit * (m22 / mass - shift.z * shift.z) + keep * s22;

	// amplitude that keeps the total extinction: mean share times sqrt(|C| / |C'|)
	let detOld = s00 * (s11 * s22 - s12 * s12) - s01 * (s01 * s22 - s12 * s02) + s02 * (s01 * s12 - s11 * s02);
	let detNew = f00 * (f11 * f22 - f12 * f12) - f01 * (f01 * f22 - f12 * f02) + f02 * (f01 * f12 - f11 * f02);
	if (detNew <= 0.0 || detOld <= 0.0) {
		splatGeometryOut[i] = out;
		return;
	}
	let amplitude = (mass / f32(n)) * sqrt(detOld / detNew);

	out.mean = vec4<f32>(mean + shift, amplitude);
	out.cov0 = vec4<f32>(f00, f01, f02, f11);
	out.cov1 = vec4<f32>(f12, f22, 0.0, 0.0);
	out.base = vec4<f32>(colorSum / mass, 1.0);
	splatGeometryOut[i] = out;
}

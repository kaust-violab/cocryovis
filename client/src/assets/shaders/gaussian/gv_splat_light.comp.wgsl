// Pure-splatting variant, step 2: light every visible splat (view dependent).
// Ambient occlusion and shadow are evaluated once per splat with the lighting
// model selected by ext.lookMode, and baked into its colour. The point they are
// evaluated at is where a viewer sees the splat: on the ray through its centre,
// at the depth where the splat alone has become half opaque. The centre itself
// lies inside the material and would always come out occluded.

struct SplatGeometry {
	mean: vec4<f32>,
	cov0: vec4<f32>,
	cov1: vec4<f32>,
	base: vec4<f32>,
}

@group(1) @binding(5)
var<storage, read> splatGeometry: array<SplatGeometry>;

// rgb: shaded colour, a: extinction amplitude
@group(1) @binding(6)
var<storage, read_write> splatAttrOut: array<vec4<f32>>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
	let i = id.x;
	if (i >= gaussGrid.count) {
		return;
	}
	let geometry = splatGeometry[i];
	if (geometry.mean.w <= 0.0) {
		splatAttrOut[i] = vec4<f32>(0.0);
		return;
	}
	// covariance of the splat in world space and its inverse
	let scale = 2.0 * volumeParameters.ratio.xyz;
	let c = mat3x3<f32>(
		vec3<f32>(geometry.cov0.x * scale.x * scale.x, geometry.cov0.y * scale.x * scale.y, geometry.cov0.z * scale.x * scale.z),
		vec3<f32>(geometry.cov0.y * scale.x * scale.y, geometry.cov0.w * scale.y * scale.y, geometry.cov1.x * scale.y * scale.z),
		vec3<f32>(geometry.cov0.z * scale.x * scale.z, geometry.cov1.x * scale.y * scale.z, geometry.cov1.y * scale.z * scale.z),
	);
	let i00 = c[1][1] * c[2][2] - c[1][2] * c[2][1];
	let i01 = c[0][2] * c[2][1] - c[0][1] * c[2][2];
	let i02 = c[0][1] * c[1][2] - c[0][2] * c[1][1];
	let det = c[0][0] * i00 + c[1][0] * i01 + c[2][0] * i02;
	let i11 = c[0][0] * c[2][2] - c[0][2] * c[2][0];
	let i12 = c[0][2] * c[1][0] - c[0][0] * c[1][2];
	let i22 = c[0][0] * c[1][1] - c[0][1] * c[1][0];
	let inverse = mat3x3<f32>(
		vec3<f32>(i00, i01, i02),
		vec3<f32>(i01, i11, i12),
		vec3<f32>(i02, i12, i22),
	) * (1.0 / det);

	let centerWorld = texToWorld(geometry.mean.xyz);
	let eye = (camera.viewInv * vec4<f32>(0.0, 0.0, 0.0, 1.0)).xyz;
	let dir = normalize(centerWorld - eye);
	let sigmaRay = inverseSqrt(max(dot(dir, inverse * dir), 1e-30));
	// optical depth of the whole splat along the central ray
	let tau = geometry.mean.w * sigmaRay * 2.50662827463;
	// depth, in standard deviations in front of the centre, at which the optical
	// depth reaches 0.7 (inverse normal distribution, Abramowitz and Stegun 26.2.23)
	let p = min(0.5, 0.7 / max(tau, 1e-6));
	let t = sqrt(- 2.0 * log(p));
	let u = max(0.0, t - (2.515517 + 0.802853 * t + 0.010328 * t * t) / (1.0 + 1.432788 * t + 0.189269 * t * t + 0.001308 * t * t * t));
	let isec0 = centerWorld - dir * (u * sigmaRay);
	let isec1 = isec0 / scale + 0.5;
	let enableAO = bool(param.enableAmbientOcclusion);
	let enableShadows = bool(param.enableSoftShadows);
	let repeats = max(ext.cacheRepeats, 1u);

	var ao = 0.0;
	var shadow = 0.0;
	var color = geometry.base.rgb;
	if (ext.lookMode == 1u) {
		let lightPos = (camera.viewInv * vec4<f32>(ext.refLightPosView, 1.0)).xyz;
		for (var r = 0u; r < repeats; r = r + 1u) {
			seedGlobal = wang_hash(i * 747796405u + r * 2891336453u + ext.frameSeed * 26699u + 1u);
			if (enableAO) {
				ao = ao + aoRef(isec1);
			}
			if (enableShadows) {
				shadow = shadow + shadowRef(isec0, isec1, lightPos);
			}
		}
		ao = ao / f32(repeats);
		shadow = shadow / f32(repeats);
		color = mix(color, color * ext.refTint, clamp(shadow * ext.refShadowWeight, 0.0, 1.0));
		color = mix(color, color * ext.refTint, clamp(ao * ext.refAoWeight, 0.0, 1.0));
		color = color * ext.refGain;
	}
	else {
		// same light as volume.vs.wgsl
		let lightPos = (camera.viewInv * vec4<f32>(0.0, 1.0, 1.0, 1.0)).xyz;
		if (enableAO) {
			for (var r = 0u; r < repeats; r = r + 1u) {
				seedGlobal = wang_hash(i * 747796405u + r * 2891336453u + ext.frameSeed * 26699u + 1u);
				ao = ao + aoFast(isec1);
			}
			ao = ao / f32(repeats);
		}
		if (enableShadows) {
			shadow = shadowFast(isec0, isec1, lightPos);
		}
		color = mix(color, vec3<f32>(0.0, 0.01, 0.02), ao);
		color = mix(color, vec3<f32>(0.0, 0.015, 0.03), shadow);
	}
	splatAttrOut[i] = vec4<f32>(color, geometry.mean.w);
}

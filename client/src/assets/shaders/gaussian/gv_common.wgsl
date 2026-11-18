// Shared declarations of the Gaussian volume pass.
//
// Group 0 repeats the bindings of volume.fs.wgsl, so the pass consumes the same
// camera, transfer-function lookup, parameter and clipping buffers as VolumePass.
// Binding 11 adds the parameters that the original pass does not have.
//
// This file is concatenated in front of one field module (gv_field_voxel.wgsl or
// gv_field_gauss.wgsl) and one entry-point module.

struct CubeOutput {
	t: f32,
	fr: f32,
}

struct Camera {
	view: mat4x4<f32>,
	viewInv: mat4x4<f32>,
	proj: mat4x4<f32>,
	mvpInv: mat4x4<f32>,
}

struct ChannelData {
	visible: u32,
	clipVisible: u32,
}

struct Param {
	enableEarlyRayTermination: u32,
	enableJittering: u32,
	enableAmbientOcclusion: u32,
	enableSoftShadows: u32,

	enableAnnotations: u32,
	sampleRate: f32,
	aoRadius: f32,
	aoStrength: f32,

	aoNumSamples: i32,
	shadowQuality: f32,
	shadowStrength: f32,
	shadowRadius: f32,

	shadowMin: f32,
	shadowMax: f32,
}

struct VolumeParameters {
	rawVolumeChannel: i32,
	numChannels: i32,
	voxelSize: f32,
	rawClippingPlane: i32,
	ratio: vec4<f32>,
}

struct ClippingPlane {
	origin: vec4<f32>,
	normal: vec4<f32>,
	enabled: i32,
}

struct AnnotationChannelData {
	color: vec4<f32>,
	enabled: u32,
}

// Parameters added by the Gaussian volume pass.
struct ExtParam {
	// 0: CoCryoViS look (volume.fs.wgsl). 1: reference look after Nano-Oetzi, Section 5.2.
	lookMode: u32,
	// 0: lighting evaluated at every ray sample. 1: lighting read from the per-Gaussian cache.
	lightingMode: u32,
	refAoSamples: u32,
	refShadowSteps: u32,

	// Reference look, ambient occlusion: sphere radius in world units, upward offset of
	// the sphere centre in radii, gain on the mean occupancy, weight of the tint.
	refAoRadius: f32,
	refAoUpOffset: f32,
	refAoGain: f32,
	refAoWeight: f32,

	// Reference look, soft shadow: radius of the spherical light (world units), reach of
	// the shadow rays (world units), gain on the weighted occupancy integral, tint weight.
	refLightRadius: f32,
	refShadowReach: f32,
	refShadowGain: f32,
	refShadowWeight: f32,

	// Shadow tint and brightness gain of the reference look.
	refTint: vec3<f32>,
	refGain: f32,

	// Light position in view space, reference look.
	refLightPosView: vec3<f32>,
	frameSeed: u32,

	// Number of sample sets averaged per Gaussian when the light cache is filled.
	cacheRepeats: u32,
	reserved0: u32,
	reserved1: u32,
	reserved2: u32,
}

@group(0) @binding(0)
var<uniform> camera: Camera;

@group(0) @binding(2)
var s: sampler;

@group(0) @binding(4)
var annotationVolume: texture_3d<f32>;

@group(0) @binding(5)
var transferFunctionLut: texture_2d<f32>;

@group(0) @binding(6)
var<storage, read> annotations: array<AnnotationChannelData>;

@group(0) @binding(7)
var<uniform> volumeParameters: VolumeParameters;

@group(0) @binding(8)
var<uniform> param: Param;

@group(0) @binding(9)
var<storage, read> channelData: array<ChannelData>;

@group(0) @binding(10)
var<uniform> clippingPlane: ClippingPlane;

@group(0) @binding(11)
var<uniform> ext: ExtParam;

var<private> seedGlobal: u32;

fn wang_hash(seedIn: u32) -> u32 {
	var seed = seedIn;
	seed = (seed ^ 61u) ^ (seed >> 16u);
	seed = seed * 9u;
	seed = seed ^ (seed >> 4u);
	seed = seed * u32(0x27d4eb2d);
	seed = seed ^ (seed >> 15u);
	return seed;
}

// Same generator as volume.fs.wgsl (including the f / cos(f) shaping).
fn rand() -> f32 {
	seedGlobal = wang_hash(seedGlobal);
	var f = f32(seedGlobal) * (1.0 / 4294967296.0);
	return f / cos(f);
}

fn rand11() -> f32 {
	var result = - 1.0 + 2.0 * rand();
	return result;
}

// Uniform in [0, 1), used by the reference look.
fn rand01() -> f32 {
	seedGlobal = wang_hash(seedGlobal);
	return f32(seedGlobal) * (1.0 / 4294967296.0);
}

// Random direction with a uniformly distributed length in [0, 1), i.e. the
// normalize(random) * rand() construction of the Nano-Oetzi desktop shader:
// samples are denser towards the centre of the ball.
fn randInBall() -> vec3<f32> {
	let z = 1.0 - 2.0 * rand01();
	let phi = 6.28318530718 * rand01();
	let r = sqrt(max(0.0, 1.0 - z * z));
	let radius = rand01();
	return vec3<f32>(r * cos(phi), r * sin(phi), z) * radius;
}

fn cube(eye: vec3<f32>, dir: vec3<f32>, size: vec3<f32>) -> CubeOutput {
	var output: CubeOutput;
	var far: f32;
	var near: f32;
	var t1: f32;
	var t2: f32;
	var t3: f32;
	output.fr = 0.0;
	far = 9999.0;
	near = - 9999.0;
	var i: i32 = 0;
	loop {
		if (i >= 3) {
			break;
		}

		if (dir[i] == 0.0) {
			if (eye[i] < - 0.0001 || eye[i] > 0.0001) {
				output.t = - 1.0;
				return output;
			}
		}
		else {
			t1 = (- size[i] - eye[i]) / dir[i];
			t2 = (size[i] - eye[i]) / dir[i];
			if (t2 > t1) {
				t3 = t1;
				t1 = t2;
				t2 = t3;
			}

			if (t2 > near) {
				near = t2;
			}
			if (t1 < far) {
				far = t1;
			}
			if (far < 0.0) {
				output.t = - 1.0;
				return output;
			}
			if (near > far) {
				output.t = - 1.0;
				return output;
			}
		}
		i = i + 1;
	}
	if (near < 0.0) {
		output.fr = far;
		output.t = 0.0;
	}
	else {
		output.fr = far;
		output.t = near;
	}
	return output;
}

fn isClipped(pos: vec3<f32>) -> bool {
	var d = dot(clippingPlane.origin.xyz, clippingPlane.normal.xyz);
	var r = dot(pos, clippingPlane.normal.xyz);
	return d < r;
}

fn color_transfer(which: i32, sampleValue: f32) -> vec4<f32> {
	var uv = vec2<f32>(clamp(sampleValue, 0.0, 1.0), (f32(which) + 0.5) / 4.0);
	return textureSampleLevel(transferFunctionLut, s, uv, 0.0);
}

fn mixAnnotationColor(color: vec3<f32>, worldPos: vec3<f32>, annotationColor: vec4<f32>) -> vec3<f32> {
	if (annotationColor.a == 0.0) {
		return color;
	}
	var stripe = annotationColor.xyz;

	var stripeStrength = 0.2;
	if (sin((worldPos.x + worldPos.y) * 100.0) > 0.0) {
		stripe = mix(stripe, vec3<f32>(0.0, 0.0, 0.0), stripeStrength);
	}
	else {
		stripe = mix(stripe, vec3<f32>(1.0, 1.0, 1.0), stripeStrength);
	}

	return mix(color, stripe, annotationColor.a);
}

fn insideUnitCube(p: vec3<f32>) -> bool {
	return p.x > 0.0 && p.x < 1.0 && p.y > 0.0 && p.y < 1.0 && p.z > 0.0 && p.z < 1.0;
}

// Texture coordinates -> world, and back (the volume box is centred at the origin
// with half-size volumeParameters.ratio).
fn texToWorld(p: vec3<f32>) -> vec3<f32> {
	return (p - 0.5) * 2.0 * volumeParameters.ratio.xyz;
}

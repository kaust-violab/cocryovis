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
	_padding: vec2<u32>,
}

struct AnnotationChannelData {
	color: vec4<f32>,
	enabled: u32,
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

@group(0) @binding(0)
var<uniform> camera: Camera;

@group(0) @binding(2)
var s: sampler;

@group(0) @binding(3)
var volume0: texture_3d<f32>;

@group(0) @binding(4)
var annotationVolume: texture_3d<f32>;

@group(0) @binding(5)
var transferFunctionLut: texture_2d<f32>;

@group(0) @binding(7)
var<uniform> volumeParameters: VolumeParameters;

@group(0) @binding(8)
var<uniform> param: Param;

@group(0) @binding(9)
var<storage, read> channelData: array<ChannelData>;

@group(0) @binding(6)
var<storage, read> annotations: array<AnnotationChannelData>;

@group(0) @binding(10)
var<uniform> clippingPlane: ClippingPlane;

struct FragmentInput {
	@location(0) eye: vec3<f32>,
	@location(1) direction: vec3<f32>,
}

struct FragmentOutput {
	@location(0) color: vec4<f32>,
	@builtin(frag_depth) frag_depth: f32,
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
	near = -9999.0;

	for (var i: i32 = 0; i < 3; i += 1) {
		if (dir[i] == 0.0) {
			if (eye[i] < -0.0001 || eye[i] > 0.0001) {
				output.t = -1.0;
				return output;
			}
		} else {
			t1 = (-size[i] - eye[i]) / dir[i];
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
				output.t = -1.0;
				return output;
			}
			if (near > far) {
				output.t = -1.0;
				return output;
			}
		}
	}

	if (near < 0.0) {
		output.fr = far;
		output.t = 0.0;
	} else {
		output.fr = far;
		output.t = near;
	}
	return output;
}

fn dataRead(pos: vec3<f32>) -> vec4<f32> {
	var mapped: vec4<f32>;
	let sample4 = textureSampleLevel(volume0, s, pos, 0.0);
	mapped.x = sample4.x * f32(channelData[0].clipVisible);
	mapped.y = sample4.y * f32(channelData[1].clipVisible);
	mapped.z = sample4.z * f32(channelData[2].clipVisible);
	mapped.w = sample4.w * f32(channelData[3].clipVisible);
	return mapped;
}

fn color_transfer(which: i32, sampleValue: f32) -> vec4<f32> {
	let uv = vec2<f32>(clamp(sampleValue, 0.0, 1.0), (f32(which) + 0.5) / 4.0);
	return textureSampleLevel(transferFunctionLut, s, uv, 0.0);
}

fn mixAnnotationColor(color: vec3<f32>, worldPos: vec3<f32>, annotationColor: vec4<f32>) -> vec3<f32> {
	if (annotationColor.a == 0.0) {
		return color;
	}

	var stripe = annotationColor.xyz;
	let stripeStrength = 0.2;
	if (sin((worldPos.x + worldPos.y) * 100.0) > 0.0) {
		stripe = mix(stripe, vec3<f32>(0.0, 0.0, 0.0), stripeStrength);
	} else {
		stripe = mix(stripe, vec3<f32>(1.0, 1.0, 1.0), stripeStrength);
	}

	return mix(color, stripe, annotationColor.a);
}

@fragment
fn main(input: FragmentInput) -> FragmentOutput {
	var output: FragmentOutput;
	output.color = vec4<f32>(0.0, 0.0, 0.0, 1.0);
	output.frag_depth = 1.0;

	if (!bool(clippingPlane.enabled)) {
		discard;
	}

	let volumeRatio = volumeParameters.ratio.xyz;
	let cubeHit = cube(input.eye, input.direction, volumeRatio);
	if (cubeHit.t < 0.0) {
		discard;
	}

	let denom = dot(clippingPlane.normal.xyz, input.direction);
	if (abs(denom) < 1e-6) {
		discard;
	}
	// if (denom >= 0.0) {
	// 	discard;
	// }

	let t = dot(clippingPlane.origin.xyz - input.eye, clippingPlane.normal.xyz) / denom;
	if (t < cubeHit.t || t > cubeHit.fr) {
		discard;
	}

	let point = input.eye + input.direction * t;
	let texPos = (point / volumeRatio) * 0.5 + 0.5;
	if (texPos.x < 0.0 || texPos.x > 1.0 || texPos.y < 0.0 || texPos.y > 1.0 || texPos.z < 0.0 || texPos.z > 1.0) {
		discard;
	}

	let masks = dataRead(texPos);
	let rawVolumeChannel = volumeParameters.rawVolumeChannel;
	let useRawVolume = rawVolumeChannel >= 0;
	let enableAnnotations = bool(param.enableAnnotations);

	var annotationColor = vec4<f32>(0.0, 0.0, 0.0, 0.0);
	if (enableAnnotations) {
		let annotationVec = textureSampleLevel(annotationVolume, s, texPos, 0.0);
		for (var i: i32 = 0; i < 4; i += 1) {
			let alpha = f32(annotations[i].enabled) * annotationVec[i];
			if (alpha > annotationColor.a) {
				annotationColor = vec4<f32>(annotations[i].color.rgb, alpha);
			}
		}
	}

	if (bool(volumeParameters.rawClippingPlane) && useRawVolume) {
		let rawValue = masks[rawVolumeChannel];
		let rawColor = mixAnnotationColor(
			vec3<f32>(rawValue, rawValue, rawValue),
			point,
			annotationColor
		);
		output.color = vec4<f32>(rawColor, 1.0);
	} else {
		let numChannels = volumeParameters.numChannels;
		var resultColor = vec3<f32>(0.0, 0.0, 0.0);
		var alphaSum = 0.0;
		for (var which: i32 = 0; which < numChannels; which += 1) {
			if (which == rawVolumeChannel) {
				continue;
			}
			let tfSample = color_transfer(which, masks[which]);
			alphaSum += tfSample.a;
			resultColor += tfSample.a * tfSample.rgb;
		}
		if (alphaSum <= 0.1) {
			discard;
		}
		output.color = vec4<f32>(
			mixAnnotationColor(resultColor, point, annotationColor),
			1.0
		);
	}

	let projPos = camera.proj * camera.view * vec4<f32>(point, 1.0);
	output.frag_depth = projPos.z / projPos.w;
	return output;
}

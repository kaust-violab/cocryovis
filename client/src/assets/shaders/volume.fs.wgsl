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

struct Ray {
	origin: vec3<f32>,
	direction: vec3<f32>,
}

struct ChannelData {
	visible: u32,
	clipVisible: u32,
	// _padding: vec2<u32>,
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

var<private> seedGlobal: u32;
var<private> lightRadius: f32;

fn wang_hash(seedIn: u32) -> u32 {
	var seed = seedIn;
	seed = (seed ^ 61u) ^ (seed >> 16u);
	seed = seed * 9u;
	seed = seed ^ (seed >> 4u);
	seed = seed * u32(0x27d4eb2d);
	seed = seed ^ (seed >> 15u);
	return seed;
}

fn rand() -> f32 {
	seedGlobal = wang_hash(seedGlobal);
	var f = f32(seedGlobal) * (1.0 / 4294967296.0);
	return f / cos(f);
}

fn rand11() -> f32 {
	var result = - 1.0 + 2.0 * rand();
	return result;
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
				//eye lies behind the cube and looks away
				output.t = - 1.0;
				return output;
			}
			if (near > far) {
				//eye is drunk
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
	// We clip the side normal is point to
}

fn dataRead(pos: vec3<f32>) -> vec4<f32> {
	var mapped: vec4<f32>;

	var sample4 = textureSampleLevel(volume0, s, pos, 0.0);
	mapped.x = sample4.x * f32(channelData[0].visible);
	mapped.y = sample4.y * f32(channelData[1].visible);
	mapped.z = sample4.z * f32(channelData[2].visible);
	mapped.w = sample4.w * f32(channelData[3].visible);

	return mapped;
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

struct FragmentInput {
	@location(0) eye: vec3<f32>,
	@location(1) direction: vec3<f32>,
	@location(2) lightPos: vec3<f32>,
	@location(3) tex_coords: vec2<f32>,
}

struct FragmentOutput {
	@location(0) color: vec4<f32>,
	@builtin(frag_depth) frag_depth: f32,
}

@fragment
fn main(input: FragmentInput) -> FragmentOutput {
	let eye = input.eye;
	let direction = input.direction;
	let lightPos = input.lightPos;
	let tex_coords = input.tex_coords;

	var output: FragmentOutput;
	output.frag_depth = 0.0;
	output.color = vec4<f32>(1.0, 0.0, 0.0, 1.0);

	var rawVolumeChannel = volumeParameters.rawVolumeChannel;
	var useRawVolume = rawVolumeChannel >= 0;
	var numChannels = volumeParameters.numChannels;
	var clippingEnabled = bool(clippingPlane.enabled);

	var volumeRatio = volumeParameters.ratio.xyz;

	// intialize random seed
	seedGlobal = u32(tex_coords.x * tex_coords.y * 1000000.0);

	//get intersection with the bounding cube (in form of distance on the ray dir * t + eye)
	var outputCube = cube(eye, direction, volumeRatio);

	if (outputCube.t < 0.0) {
		discard;
	}

	var stepSize = 0.01;
	stepSize = stepSize / param.sampleRate;

	// ray offset jittering
	if (bool(param.enableJittering)) {
		outputCube.t = outputCube.t + rand() * stepSize * 1.0;
	}

	var iterations = i32((outputCube.fr - outputCube.t) / stepSize);

	var src = vec4<f32>(0.0, 0.0, 0.0, 0.0);
	var dst = vec4<f32>(0.0, 0.0, 0.0, 0.0);

	// raymarching
	var accumA = 0.0;
	var accumC = vec3<f32>(0.0, 0.0, 0.0);

	var quit = false;
	var firstHit = true;

	var enableAO = bool(param.enableAmbientOcclusion);
	var enableSoftShadows = bool(param.enableSoftShadows);
	var enableEarlyRayTermination = bool(param.enableEarlyRayTermination);
	var enableAnnotations = bool(param.enableAnnotations);

	for (var i: i32 = 0; i < iterations; i += 1) {
		//calculate intersection along the ray
		var tmp = f32(i) * stepSize + outputCube.t;
		var isec0 = tmp * direction + eye;

		var isec1 = (isec0 / volumeRatio) * 0.5 + 0.5;

		if (isec1.x < 0.0 || isec1.x > 1.0 || isec1.y < 0.0 || isec1.y > 1.0 || isec1.z < 0.0 || isec1.z > 1.0) {
			continue;
		}

		if (clippingEnabled && isClipped(isec0)) {
			continue;
		}

		var masks = vec4<f32>(0.0);
		masks = dataRead(isec1);

		// ======================== SAMPLE ANNOTATION VOLUME ========================
		var annotationColor = vec4<f32>(0, 0, 0, 0);
		if (enableAnnotations) {
			var annotationVec = textureSampleLevel(annotationVolume, s, isec1, 0.0);
			for (var i: i32 = 0; i < 4; i += 1) {
				var alpha: f32 = f32(annotations[i].enabled) * annotationVec[i];
				if (alpha > annotationColor.a) {
					annotationColor = vec4<f32>(annotations[i].color.rgb, alpha);
				}
			}
		}

		// store depth of first hit
		if (firstHit) {
			var projPos = camera.proj * camera.view * vec4<f32>(isec0.xyz, 1.0);
			output.frag_depth = projPos.z / projPos.w;
			firstHit = false;
		}

		// voxels with low influence are skipped
		var influence = 0.0;

		for (var i: i32 = 0; i < numChannels; i = i + 1) {
			if (i != rawVolumeChannel) {
				influence += color_transfer(i, masks[i]).a;
			}
		}

		if (influence <= 0.2 || (useRawVolume && masks[rawVolumeChannel] <= 0.1)) {
			continue;
		}

		// ============= OBJECTS SPACE AMBIENT OCCLUSION =============
		var ao = 0.0;
		if (enableAO) {
			var radius = param.aoRadius * 0.015 * volumeParameters.voxelSize;

			for (var j: i32 = 0; j < param.aoNumSamples; j = j + 1) {
				var randomOffset = vec3<f32>(rand11(), rand11(), rand11());
				randomOffset = normalize(randomOffset);
				randomOffset = randomOffset / volumeRatio;
				var offsetLength = 0.2 + rand() * 0.5;
				randomOffset = randomOffset * radius * offsetLength;

				var sample_pos = isec1 + randomOffset;
				var sample_var = vec3<f32>(0.0);
				
				var value = 0.0;
				// sample only within bounds of the texture
				if (sample_pos.x > 0.0 && sample_pos.x < 1.0 && sample_pos.y > 0.0 && sample_pos.y < 1.0 && sample_pos.z > 0.0 && sample_pos.z < 1.0) {
					sample_var = dataRead(sample_pos).xyz;
					for (var i: i32 = 0; i < numChannels; i = i + 1) {
						if (i != rawVolumeChannel) {
							value += color_transfer(i, sample_var[i]).a;
						}
					}
				}
				value = clamp(value, 0.0, 1.0);
				var occlusion = 1.0 - value;

				ao = ao + occlusion;
			}
			ao = ao / f32(param.aoNumSamples);
			ao = ao * param.aoStrength;
		}

		// ======================== SOFT SHADOWS ========================
		var shadow = 0.0;
		if (enableSoftShadows) {
			var sTotal: f32;

			sTotal = 0.0;

			var quality: i32;
			quality = 1;

			//var samplingRadiusShadow = 0.2;
			var stepShadow = 0.05 / param.shadowQuality;
			var shadowStrength = param.shadowStrength * 5.0;
			var shadowSampleCount = 0;

			for (var q: i32 = 0; q < quality; q = q + 1) {
				for (var t: f32 = 0.05; t < 1.0; t = t + stepShadow) {
					var halfV = normalize(lightPos - isec1);

					var sample_pos = isec1 + halfV * t * param.shadowRadius;
					var sample_pos_clip = isec0 + halfV * t * param.shadowRadius * 2.;

					var sample_var = vec3<f32>(0.0);
					// sample only within bounds of the texture
					if (sample_pos.x > 0.0 && sample_pos.x < 1.0 && sample_pos.y > 0.0 && sample_pos.y < 1.0 && sample_pos.z > 0.0 && sample_pos.z < 1.0 && (!clippingEnabled || !isClipped(sample_pos_clip))) {
						sample_var = dataRead(sample_pos).xyz;
					}

					var value = 1.0 - (sample_var.x + sample_var.y + sample_var.z);
					var low = param.shadowMin;
					var high = param.shadowMax;
					var occlusion = 1.0 - clamp((value - low) / (high - low), 0.0, 1.0);

					shadow = shadow + (occlusion);
					// pow((0.25 - t) * 2.0, 1.0)

					//sample count for the shadow normalization
					shadowSampleCount = shadowSampleCount + 1;
				}

				sTotal = sTotal + shadow;
			}
			shadow = sTotal / f32(shadowSampleCount);
			shadow = shadow * shadowStrength;
			shadow = clamp(shadow, 0.0, 1.0);
		}

		// ============= COLOR AND ALPHA ACCUMULATION =============
		for (var which: i32 = 0; which < numChannels; which += 1) {
			if (which == rawVolumeChannel) {
				continue;
			}
			var tfSample = color_transfer(which, masks[which]);
			var alpha = tfSample.a;
			var color = tfSample.rgb;

			// alpha normalization based on the stepSize
			alpha = alpha * stepSize / 0.0025;

			// alpha normalization - correct, but slower formula
			//var ds = stepSize * 20.0;
			//alpha = 1.0 - pow(1.0 - alpha, ds);

			// apply original data, only use when raw data is available
			if (useRawVolume) {
				alpha = alpha * masks[rawVolumeChannel];
			}

			color = mix(color, vec3<f32>(0.0, 0.01, 0.02), ao);
			color = mix(color, vec3<f32>(0.0, 0.015, 0.03), shadow);
			color = mixAnnotationColor(color, isec0, annotationColor);

			//front to back alpha compositing
			accumC = accumC + (1.0 - accumA) * color.xyz * alpha;
			accumA = accumA + (1.0 - accumA) * alpha;

			// break from loop on high enough alpha value
			if (enableEarlyRayTermination && accumA >= 0.8) {
				accumA = 1.0;
				quit = true;
				break;
			}
		}

		// early ray termination
		if (quit) {
			break;
		}
	}

	// make the picture brighter
	// accumC = accumC * 1.5;

	var fragColor = vec4<f32>(accumC.x, accumC.y, accumC.z, accumA);

	output.color = fragColor;

	return output;
}
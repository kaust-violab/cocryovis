// Channel read-out and the two lighting models. Needs gv_common.wgsl and a field
// module that defines fieldAt(pos) in texture coordinates.

fn dataRead(pos: vec3<f32>) -> vec4<f32> {
	var mapped: vec4<f32>;

	var sample4 = fieldAt(pos);
	mapped.x = sample4.x * f32(channelData[0].visible);
	mapped.y = sample4.y * f32(channelData[1].visible);
	mapped.z = sample4.z * f32(channelData[2].visible);
	mapped.w = sample4.w * f32(channelData[3].visible);

	return mapped;
}

// ---------------------------------------------------------------------------
// CoCryoViS look: statement-for-statement the code of volume.fs.wgsl, so that
// with the voxel field the image equals the one of VolumePass.
// ---------------------------------------------------------------------------

fn aoFast(isec1: vec3<f32>) -> f32 {
	var rawVolumeChannel = volumeParameters.rawVolumeChannel;
	var numChannels = volumeParameters.numChannels;
	var volumeRatio = volumeParameters.ratio.xyz;

	var ao = 0.0;
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
	return ao;
}

fn shadowFast(isec0: vec3<f32>, isec1: vec3<f32>, lightPos: vec3<f32>) -> f32 {
	var clippingEnabled = bool(clippingPlane.enabled);
	var shadow = 0.0;
	var sTotal: f32;

	sTotal = 0.0;

	var quality: i32;
	quality = 1;

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

			//sample count for the shadow normalization
			shadowSampleCount = shadowSampleCount + 1;
		}

		sTotal = sTotal + shadow;
	}
	shadow = sTotal / f32(shadowSampleCount);
	shadow = shadow * shadowStrength;
	shadow = clamp(shadow, 0.0, 1.0);
	return shadow;
}

// ---------------------------------------------------------------------------
// Reference look after Nano-Oetzi (TVCG), Section 5.2, with the constants of the
// desktop shader (fsWBGPU.txt): gradient-free occlusion from a sphere that is
// pushed upwards, and soft shadows by Monte Carlo sampling of a cone towards a
// spherical light.
// ---------------------------------------------------------------------------

// Opacity of whatever occupies a point: strongest class opacity, times the
// tomogram value when a raw channel is present.
fn occluderAt(pos: vec3<f32>) -> f32 {
	if (!insideUnitCube(pos)) {
		return 0.0;
	}
	let rawVolumeChannel = volumeParameters.rawVolumeChannel;
	let numChannels = volumeParameters.numChannels;
	let m = dataRead(pos);
	var a = 0.0;
	for (var i: i32 = 0; i < numChannels; i = i + 1) {
		if (i != rawVolumeChannel) {
			a = max(a, color_transfer(i, m[i]).a);
		}
	}
	if (rawVolumeChannel >= 0) {
		a = a * m[rawVolumeChannel];
	}
	return a;
}

fn aoRef(isec1: vec3<f32>) -> f32 {
	let n = max(ext.refAoSamples, 1u);
	// world -> texture displacement
	let toTex = 0.5 / volumeParameters.ratio.xyz;
	let radius = ext.refAoRadius * param.aoRadius;
	var acc = 0.0;
	for (var j: u32 = 0u; j < n; j = j + 1u) {
		var d = randInBall();
		d.y = d.y + ext.refAoUpOffset;
		acc = acc + occluderAt(isec1 + d * radius * toTex);
	}
	let ao = clamp(acc / f32(n) * ext.refAoGain, 0.0, 1.0);
	return ao * (param.aoStrength / 0.9);
}

fn shadowRef(isec0: vec3<f32>, isec1: vec3<f32>, lightPosWorld: vec3<f32>) -> f32 {
	let clippingEnabled = bool(clippingPlane.enabled);
	let n = max(u32(f32(ext.refShadowSteps) * param.shadowQuality), 1u);
	let dt = 0.99 / f32(n);
	let toTex = 0.5 / volumeParameters.ratio.xyz;
	var acc = 0.0;
	for (var i: u32 = 0u; i < n; i = i + 1u) {
		// one stratum per step, jittered
		let t = 0.01 + (f32(i) + rand01()) * dt;
		// the cone widens with distance: the aim point is spread over the light sphere
		let aim = lightPosWorld + randInBall() * (ext.refLightRadius * t);
		let dir = normalize(aim - isec0);
		let offset = dir * (t * ext.refShadowReach);
		if (clippingEnabled && isClipped(isec0 + offset)) {
			continue;
		}
		let w = (1.0 - t) * (1.0 - t);
		acc = acc + occluderAt(isec1 + offset * toTex) * w * dt;
	}
	let shadow = clamp(acc * ext.refShadowGain, 0.0, 1.0);
	return shadow * (param.shadowStrength / 0.5);
}

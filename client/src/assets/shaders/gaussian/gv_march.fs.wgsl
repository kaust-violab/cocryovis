// Ray-marching entry point of the Gaussian volume pass. The loop is the one of
// volume.fs.wgsl; the field it samples is supplied by the field module, and the
// lighting by gv_lighting.wgsl.

struct FragmentInput {
	@location(0) eye: vec3<f32>,
	@location(1) direction: vec3<f32>,
	@location(2) lightPos: vec3<f32>,
	@location(3) tex_coords: vec2<f32>,
	@builtin(position) fragCoord: vec4<f32>,
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

	let referenceLook = ext.lookMode == 1u;
	let cachedLighting = ext.lightingMode == 1u;

	// intialize random seed
	if (referenceLook) {
		seedGlobal = wang_hash(u32(input.fragCoord.x) * 1973u + u32(input.fragCoord.y) * 9277u + ext.frameSeed * 26699u);
	}
	else {
		seedGlobal = u32(tex_coords.x * tex_coords.y * 1000000.0);
	}

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

	// raymarching
	var accumA = 0.0;
	var accumC = vec3<f32>(0.0, 0.0, 0.0);

	var quit = false;
	var firstHit = true;

	var enableAO = bool(param.enableAmbientOcclusion);
	var enableSoftShadows = bool(param.enableSoftShadows);
	var enableEarlyRayTermination = bool(param.enableEarlyRayTermination);
	var enableAnnotations = bool(param.enableAnnotations);

	let refLightPos = (camera.viewInv * vec4<f32>(ext.refLightPosView, 1.0)).xyz;

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

		// ============= AMBIENT OCCLUSION AND SOFT SHADOWS =============
		var ao = 0.0;
		var shadow = 0.0;
		if (cachedLighting) {
			let cached = cachedLightAt(isec1);
			if (enableAO) {
				ao = cached.x;
			}
			if (enableSoftShadows) {
				shadow = cached.y;
			}
		}
		else if (referenceLook) {
			if (enableAO) {
				ao = aoRef(isec1);
			}
			if (enableSoftShadows) {
				shadow = shadowRef(isec0, isec1, refLightPos);
			}
		}
		else {
			if (enableAO) {
				ao = aoFast(isec1);
			}
			if (enableSoftShadows) {
				shadow = shadowFast(isec0, isec1, lightPos);
			}
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

			// apply original data, only use when raw data is available
			if (useRawVolume) {
				alpha = alpha * masks[rawVolumeChannel];
			}

			if (referenceLook) {
				color = mix(color, color * ext.refTint, clamp(shadow * ext.refShadowWeight, 0.0, 1.0));
				color = mix(color, color * ext.refTint, clamp(ao * ext.refAoWeight, 0.0, 1.0));
				color = color * ext.refGain;
			}
			else {
				color = mix(color, vec3<f32>(0.0, 0.01, 0.02), ao);
				color = mix(color, vec3<f32>(0.0, 0.015, 0.03), shadow);
			}
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

	var fragColor = vec4<f32>(accumC.x, accumC.y, accumC.z, accumA);

	output.color = fragColor;

	return output;
}

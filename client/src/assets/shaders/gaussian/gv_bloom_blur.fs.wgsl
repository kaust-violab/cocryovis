// Bloom, blur passes. Follows the Nano-Oetzi post-processing chain: a bright
// pass (pixels darker than the threshold are dropped) followed by a separable
// Gaussian blur with weights exp(-(1.5 i / amount)^2).

struct BloomParams {
	// (1, 0) or (0, 1)
	direction: vec2<f32>,
	// blur extent in pixels
	amount: f32,
	// mean brightness below which a pixel does not bloom; negative disables the bright pass
	threshold: f32,
	strength: f32,
	reserved0: f32,
	reserved1: f32,
	reserved2: f32,
}

@group(0) @binding(0) var bloomSampler: sampler;
@group(0) @binding(1) var source: texture_2d<f32>;
@group(0) @binding(2) var<uniform> bloom: BloomParams;

fn brightPass(color: vec4<f32>) -> vec4<f32> {
	if (bloom.threshold < 0.0) {
		return color;
	}
	let c = clamp(color.rgb, vec3<f32>(0.0), vec3<f32>(1.0));
	if ((c.r + c.g + c.b) / 3.0 < bloom.threshold) {
		return vec4<f32>(0.0, 0.0, 0.0, color.a);
	}
	return vec4<f32>(c, color.a);
}

@fragment
fn main(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
	let dims = vec2<f32>(textureDimensions(source, 0));
	let uv = position.xy / dims;
	let texel = bloom.direction / dims;
	let amount = max(bloom.amount, 0.0);
	if (amount == 0.0) {
		return brightPass(textureSampleLevel(source, bloomSampler, uv, 0.0));
	}
	let n = i32(amount + 1.0);
	var color = vec4<f32>(0.0);
	var total = 0.0;
	for (var i = - n; i <= n; i = i + 1) {
		let sc = uv + texel * f32(i);
		if (sc.x < 0.0 || sc.x > 1.0 || sc.y < 0.0 || sc.y > 1.0) {
			continue;
		}
		let x = f32(i) / amount * 1.5;
		let w = exp(- x * x);
		color = color + brightPass(textureSampleLevel(source, bloomSampler, sc, 0.0)) * w;
		total = total + w;
	}
	return color / max(total, 1e-6);
}

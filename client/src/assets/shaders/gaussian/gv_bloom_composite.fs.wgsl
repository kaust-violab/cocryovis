// Bloom, final pass: image plus strength times its blurred bright parts.

struct BloomParams {
	direction: vec2<f32>,
	amount: f32,
	threshold: f32,
	strength: f32,
	reserved0: f32,
	reserved1: f32,
	reserved2: f32,
}

@group(0) @binding(0) var bloomSampler: sampler;
@group(0) @binding(1) var source: texture_2d<f32>;
@group(0) @binding(2) var<uniform> bloom: BloomParams;
@group(0) @binding(3) var blurred: texture_2d<f32>;

@fragment
fn main(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
	let dims = vec2<f32>(textureDimensions(source, 0));
	let uv = position.xy / dims;
	let base = textureSampleLevel(source, bloomSampler, uv, 0.0);
	let glow = textureSampleLevel(blurred, bloomSampler, uv, 0.0);
	return vec4<f32>(base.rgb + glow.rgb * bloom.strength, base.a);
}

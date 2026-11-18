// Pure-splatting variant, step 3: write the accumulated splats into the pass
// framebuffer with the conventions of the ray marcher (colour times coverage,
// full coverage once the ray would have terminated).

@group(0) @binding(0)
var accumulation: texture_2d<f32>;

struct ResolveParams {
	earlyTermination: u32,
	// coverage at which the ray marcher stops on average (it stops at the first
	// sample past 0.8, so the colour it has gathered by then is a little above 0.8)
	terminationCoverage: f32,
	reserved0: u32,
	reserved1: u32,
}

@group(0) @binding(1)
var<uniform> resolveParams: ResolveParams;

struct FragmentOutput {
	@location(0) color: vec4<f32>,
	@builtin(frag_depth) frag_depth: f32,
}

@fragment
fn main(@builtin(position) position: vec4<f32>) -> FragmentOutput {
	let acc = textureLoad(accumulation, vec2<i32>(position.xy), 0);
	var out: FragmentOutput;
	var alpha = clamp(acc.a, 0.0, 1.0);
	var color = acc.rgb;
	if (bool(resolveParams.earlyTermination) && alpha >= 0.8) {
		// The marcher stops here and reports full coverage; the splats went on
		// blending. Scale their colour back to the coverage the marcher gathers.
		color = color * (resolveParams.terminationCoverage / alpha);
		alpha = 1.0;
	}
	out.color = vec4<f32>(color, alpha);
	out.frag_depth = 0.0;
	return out;
}

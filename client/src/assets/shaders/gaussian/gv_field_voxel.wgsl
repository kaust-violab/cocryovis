// Field module: the four channels come from the packed 3D texture, as in VolumePass.

@group(0) @binding(3)
var volume0: texture_3d<f32>;

fn fieldAt(pos: vec3<f32>) -> vec4<f32> {
	return textureSampleLevel(volume0, s, pos, 0.0);
}

// The voxel field has no per-primitive lighting cache.
fn cachedLightAt(pos: vec3<f32>) -> vec2<f32> {
	return vec2<f32>(0.0, 0.0);
}

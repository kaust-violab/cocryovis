/**
 * A set of anisotropic 3D Gaussians with up to four channel weights each, and
 * the uniform grid the shaders use to find the Gaussians near a point.
 *
 * File format (see tools/gaussian-renderer/python/gaussian_io.py): a JSON
 * header and a little-endian float32 binary with 14 values per Gaussian:
 * mean (x, y, z), scale (three standard deviations), rotation quaternion
 * (w, x, y, z), four channel weights. Coordinates are continuous voxel
 * coordinates of `volumeSize`.
 *
 * On the GPU everything lives in the texture space of the volume box,
 * [0, 1]^3, the same space the voxel renderer samples its 3D texture in.
 */

export interface GaussianSceneHeader {
  format: "cocryovis-gaussians";
  version: number;
  file: string;
  count: number;
  layout: "mean3_scale3_quat4_weights4";
  space: "voxel";
  volumeSize: { x: number; y: number; z: number };
  channels: string[];
  kernel: { cutoffSigma: number; shifted: boolean };
}

export interface GaussianGridOptions {
  /** Edge of a grid cell in units of the median standard deviation. */
  cellSizeInSigma?: number;
  /** Upper bound on the number of grid cells. */
  maxCells?: number;
}

export const FLOATS_PER_GAUSSIAN_FILE = 14;
/** Four vec4f per Gaussian on the GPU: mean, two rows of the inverse covariance, weights. */
export const FLOATS_PER_GAUSSIAN_GPU = 16;

export interface GaussianGrid {
  dims: [number, number, number];
  /** (offset, count) per cell. */
  cells: Uint32Array;
  /** Gaussian indices, grouped by cell. */
  indices: Uint32Array;
  maxPerCell: number;
  meanPerOccupiedCell: number;
}

export interface PackedGaussians {
  count: number;
  /** FLOATS_PER_GAUSSIAN_GPU floats per Gaussian. */
  gpu: Float32Array;
  /** Half extent of the axis-aligned bounding box of each kernel support, texture space. */
  halfExtents: Float32Array;
  /** Standard deviations along x, y, z in texture space if the Gaussian is axis-aligned, else 0. */
  axisSigmas: Float32Array;
  cutoffSigma: number;
  shifted: boolean;
}

/**
 * Converts file-layout Gaussians (voxel space) into the GPU layout (texture
 * space). With x_tex = x_voxel / N, the covariance becomes S C S and its
 * inverse S^-1 C^-1 S^-1, where S = diag(1 / N).
 */
export function packGaussians(
  header: GaussianSceneHeader,
  data: Float32Array
): PackedGaussians {
  const n = header.count;
  if (data.length < n * FLOATS_PER_GAUSSIAN_FILE) {
    throw new Error(
      `Gaussian file is too short: ${data.length} floats for ${n} Gaussians`
    );
  }
  const size = [header.volumeSize.x, header.volumeSize.y, header.volumeSize.z];
  const cutoff = header.kernel.cutoffSigma;
  const gpu = new Float32Array(n * FLOATS_PER_GAUSSIAN_GPU);
  const halfExtents = new Float32Array(n * 3);
  const axisSigmas = new Float32Array(n * 3);
  const r = new Float64Array(9);

  for (let i = 0; i < n; i++) {
    const f = i * FLOATS_PER_GAUSSIAN_FILE;
    const o = i * FLOATS_PER_GAUSSIAN_GPU;

    // Rotation matrix from the quaternion (w, x, y, z).
    let qw = data[f + 6];
    let qx = data[f + 7];
    let qy = data[f + 8];
    let qz = data[f + 9];
    const qn = Math.hypot(qw, qx, qy, qz) || 1;
    qw /= qn;
    qx /= qn;
    qy /= qn;
    qz /= qn;
    r[0] = 1 - 2 * (qy * qy + qz * qz);
    r[1] = 2 * (qx * qy - qw * qz);
    r[2] = 2 * (qx * qz + qw * qy);
    r[3] = 2 * (qx * qy + qw * qz);
    r[4] = 1 - 2 * (qx * qx + qz * qz);
    r[5] = 2 * (qy * qz - qw * qx);
    r[6] = 2 * (qx * qz - qw * qy);
    r[7] = 2 * (qy * qz + qw * qx);
    r[8] = 1 - 2 * (qx * qx + qy * qy);

    const s0 = Math.max(data[f + 3], 1e-6);
    const s1 = Math.max(data[f + 4], 1e-6);
    const s2 = Math.max(data[f + 5], 1e-6);
    const v0 = s0 * s0;
    const v1 = s1 * s1;
    const v2 = s2 * s2;

    // Covariance C = R diag(v) R^T and its inverse, both in voxel space.
    // Entry (a, b) = sum_k R[a][k] R[b][k] v_k.
    const cov = (a: number, b: number) =>
      r[a * 3] * r[b * 3] * v0 +
      r[a * 3 + 1] * r[b * 3 + 1] * v1 +
      r[a * 3 + 2] * r[b * 3 + 2] * v2;
    const inv = (a: number, b: number) =>
      (r[a * 3] * r[b * 3]) / v0 +
      (r[a * 3 + 1] * r[b * 3 + 1]) / v1 +
      (r[a * 3 + 2] * r[b * 3 + 2]) / v2;

    gpu[o] = data[f] / size[0];
    gpu[o + 1] = data[f + 1] / size[1];
    gpu[o + 2] = data[f + 2] / size[2];
    gpu[o + 3] = 0;

    // Inverse covariance in texture space: entry (a, b) scales by N_a N_b.
    gpu[o + 4] = inv(0, 0) * size[0] * size[0];
    gpu[o + 5] = inv(0, 1) * size[0] * size[1];
    gpu[o + 6] = inv(0, 2) * size[0] * size[2];
    gpu[o + 7] = inv(1, 1) * size[1] * size[1];
    gpu[o + 8] = inv(1, 2) * size[1] * size[2];
    gpu[o + 9] = inv(2, 2) * size[2] * size[2];

    gpu[o + 12] = data[f + 10];
    gpu[o + 13] = data[f + 11];
    gpu[o + 14] = data[f + 12];
    gpu[o + 15] = data[f + 13];

    for (let a = 0; a < 3; a++) {
      halfExtents[i * 3 + a] = (cutoff * Math.sqrt(cov(a, a))) / size[a];
    }
    const axisAligned =
      Math.abs(r[1]) + Math.abs(r[2]) + Math.abs(r[5]) < 1e-6 ||
      (Math.abs(s0 - s1) < 1e-6 * s0 && Math.abs(s1 - s2) < 1e-6 * s1);
    if (axisAligned) {
      for (let a = 0; a < 3; a++) {
        axisSigmas[i * 3 + a] = Math.sqrt(cov(a, a)) / size[a];
      }
    }
  }
  return {
    count: n,
    gpu,
    halfExtents,
    axisSigmas,
    cutoffSigma: cutoff,
    shifted: header.kernel.shifted,
  };
}

function median(values: Float32Array, stride: number, offset: number) {
  const n = Math.floor(values.length / stride);
  const step = Math.max(1, Math.floor(n / 20000));
  const sample: number[] = [];
  for (let i = 0; i < n; i += step) sample.push(values[i * stride + offset]);
  sample.sort((a, b) => a - b);
  return sample.length ? sample[sample.length >> 1] : 0;
}

/**
 * Builds the uniform grid over [0, 1]^3. A Gaussian is listed in every cell
 * its kernel support can reach. For axis-aligned Gaussians the test is exact
 * (ellipsoid against box); otherwise the bounding box of the support is used.
 */
export function buildGaussianGrid(
  packed: PackedGaussians,
  { cellSizeInSigma = 2.0, maxCells = 6_000_000 }: GaussianGridOptions = {}
): GaussianGrid {
  const n = packed.count;
  const cutoff = packed.cutoffSigma;
  const dims: [number, number, number] = [1, 1, 1];
  for (let a = 0; a < 3; a++) {
    const sigma = median(packed.halfExtents, 3, a) / cutoff;
    const cell = Math.max(sigma * cellSizeInSigma, 1e-4);
    dims[a] = Math.min(1024, Math.max(1, Math.round(1 / cell)));
  }
  let total = dims[0] * dims[1] * dims[2];
  if (total > maxCells) {
    const shrink = Math.cbrt(maxCells / total);
    for (let a = 0; a < 3; a++)
      dims[a] = Math.max(1, Math.floor(dims[a] * shrink));
    total = dims[0] * dims[1] * dims[2];
  }

  const cutoff2 = cutoff * cutoff;
  const lo = new Int32Array(3);
  const hi = new Int32Array(3);
  const counts = new Uint32Array(total);

  // Calls visit(cellIndex) for every cell reached by Gaussian i.
  const forEachCell = (i: number, visit: (cell: number) => void) => {
    const o = i * FLOATS_PER_GAUSSIAN_GPU;
    for (let a = 0; a < 3; a++) {
      const c = packed.gpu[o + a];
      const h = packed.halfExtents[i * 3 + a];
      lo[a] = Math.max(0, Math.floor((c - h) * dims[a]));
      hi[a] = Math.min(dims[a] - 1, Math.floor((c + h) * dims[a]));
    }
    const sx = packed.axisSigmas[i * 3];
    const sy = packed.axisSigmas[i * 3 + 1];
    const sz = packed.axisSigmas[i * 3 + 2];
    const exact = sx > 0;
    const cx = packed.gpu[o];
    const cy = packed.gpu[o + 1];
    const cz = packed.gpu[o + 2];
    for (let z = lo[2]; z <= hi[2]; z++) {
      let dz = 0;
      if (exact) {
        const z0 = z / dims[2];
        const z1 = (z + 1) / dims[2];
        dz = (cz < z0 ? z0 - cz : cz > z1 ? cz - z1 : 0) / sz;
      }
      for (let y = lo[1]; y <= hi[1]; y++) {
        let dy = 0;
        if (exact) {
          const y0 = y / dims[1];
          const y1 = (y + 1) / dims[1];
          dy = (cy < y0 ? y0 - cy : cy > y1 ? cy - y1 : 0) / sy;
        }
        for (let x = lo[0]; x <= hi[0]; x++) {
          if (exact) {
            const x0 = x / dims[0];
            const x1 = (x + 1) / dims[0];
            const dx = (cx < x0 ? x0 - cx : cx > x1 ? cx - x1 : 0) / sx;
            if (dx * dx + dy * dy + dz * dz >= cutoff2) continue;
          }
          visit(x + dims[0] * (y + dims[1] * z));
        }
      }
    }
  };

  for (let i = 0; i < n; i++) forEachCell(i, (cell) => counts[cell]++);

  const cells = new Uint32Array(total * 2);
  let running = 0;
  let maxPerCell = 0;
  let occupied = 0;
  for (let c = 0; c < total; c++) {
    cells[c * 2] = running;
    cells[c * 2 + 1] = counts[c];
    running += counts[c];
    if (counts[c] > maxPerCell) maxPerCell = counts[c];
    if (counts[c] > 0) occupied++;
  }
  const indices = new Uint32Array(Math.max(running, 1));
  const cursor = new Uint32Array(total);
  for (let i = 0; i < n; i++) {
    forEachCell(i, (cell) => {
      indices[cells[cell * 2] + cursor[cell]++] = i;
    });
  }
  return {
    dims,
    cells,
    indices,
    maxPerCell,
    meanPerOccupiedCell: occupied ? running / occupied : 0,
  };
}

/** GPU resources of a Gaussian scene. */
export class GaussianScene {
  readonly count: number;
  readonly header: GaussianSceneHeader;
  readonly grid: GaussianGrid;
  readonly packed: PackedGaussians;

  readonly gridUniform: GPUBuffer;
  readonly gaussianBuffer: GPUBuffer;
  readonly cellBuffer: GPUBuffer;
  readonly indexBuffer: GPUBuffer;
  /** Per Gaussian: ambient occlusion, shadow, kernel sum at the centre, unused. */
  readonly lightCacheBuffer: GPUBuffer;

  constructor(
    private readonly device: GPUDevice,
    header: GaussianSceneHeader,
    data: Float32Array,
    gridOptions?: GaussianGridOptions
  ) {
    this.header = header;
    this.count = header.count;
    this.packed = packGaussians(header, data);
    this.grid = buildGaussianGrid(this.packed, gridOptions);

    const storage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;
    this.gaussianBuffer = this.upload("Gaussians", this.packed.gpu, storage);
    this.cellBuffer = this.upload(
      "Gaussian grid cells",
      this.grid.cells,
      storage
    );
    this.indexBuffer = this.upload(
      "Gaussian grid indices",
      this.grid.indices,
      storage
    );
    this.lightCacheBuffer = device.createBuffer({
      label: "Gaussian light cache",
      size: Math.max(this.count, 1) * 16,
      usage: storage | GPUBufferUsage.COPY_SRC,
    });

    // struct GaussGrid in gv_field_gauss.wgsl (32 bytes).
    const cutoffQ = this.packed.cutoffSigma * this.packed.cutoffSigma;
    const shift = this.packed.shifted ? Math.exp(-0.5 * cutoffQ) : 0;
    const uniform = new ArrayBuffer(32);
    new Uint32Array(uniform, 0, 4).set([...this.grid.dims, this.count]);
    new Float32Array(uniform, 16, 4).set([cutoffQ, shift, 1 / (1 - shift), 0]);
    this.gridUniform = this.upload(
      "Gaussian grid parameters",
      new Uint8Array(uniform),
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    );
  }

  private upload(
    label: string,
    data: Float32Array | Uint32Array | Uint8Array,
    usage: GPUBufferUsageFlags
  ) {
    const buffer = this.device.createBuffer({
      label,
      size: Math.max(16, Math.ceil(data.byteLength / 4) * 4),
      usage,
    });
    this.device.queue.writeBuffer(
      buffer,
      0,
      data.buffer,
      data.byteOffset,
      data.byteLength
    );
    return buffer;
  }

  /** Loads a scene from the URL of its JSON header. */
  static async load(
    device: GPUDevice,
    headerUrl: string,
    gridOptions?: GaussianGridOptions
  ) {
    const header = (await (
      await fetch(headerUrl)
    ).json()) as GaussianSceneHeader;
    if (header.format !== "cocryovis-gaussians") {
      throw new Error(`${headerUrl} is not a Gaussian scene header`);
    }
    const binUrl = new URL(
      header.file,
      new URL(headerUrl, globalThis.location?.href)
    ).href;
    const data = new Float32Array(await (await fetch(binUrl)).arrayBuffer());
    return new GaussianScene(device, header, data, gridOptions);
  }

  destroy() {
    this.gridUniform.destroy();
    this.gaussianBuffer.destroy();
    this.cellBuffer.destroy();
    this.indexBuffer.destroy();
    this.lightCacheBuffer.destroy();
  }
}

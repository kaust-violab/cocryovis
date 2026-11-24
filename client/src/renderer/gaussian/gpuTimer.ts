/**
 * Measures how long one render or compute pass takes on the GPU, with the
 * optional "timestamp-query" feature (the device must have been created with
 * it). Adapted from the GpuTimer of the GPU development guide.
 *
 * Usage per frame: pass `timestampWrites` into the pass descriptor, call
 * `resolve(encoder)` after the pass and before `encoder.finish()`, submit,
 * then `await read()`. While a measurement is in flight its read buffer is
 * mapped or waiting to be mapped and cannot receive the next copy, so `ready`
 * is false and the caller skips timing that frame.
 */
export class GpuTimer {
  private readonly querySet: GPUQuerySet;
  private readonly resolveBuffer: GPUBuffer;
  private readonly readBuffer: GPUBuffer;
  private pending = false;

  constructor(device: GPUDevice) {
    this.querySet = device.createQuerySet({ type: "timestamp", count: 2 });
    this.resolveBuffer = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
    });
    this.readBuffer = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
  }

  /** False while the previous measurement has not been read yet. */
  get ready() {
    return !this.pending;
  }

  /** Goes into the descriptor of beginRenderPass or beginComputePass. */
  get timestampWrites() {
    return {
      querySet: this.querySet,
      beginningOfPassWriteIndex: 0,
      endOfPassWriteIndex: 1,
    };
  }

  /** Call after pass.end() and before encoder.finish(). */
  resolve(encoder: GPUCommandEncoder) {
    encoder.resolveQuerySet(this.querySet, 0, 2, this.resolveBuffer, 0);
    encoder.copyBufferToBuffer(this.resolveBuffer, 0, this.readBuffer, 0, 16);
    this.pending = true;
  }

  /** Call after queue.submit(). Milliseconds; a negative value means discard. */
  async read() {
    try {
      await this.readBuffer.mapAsync(GPUMapMode.READ);
      const t = new BigInt64Array(this.readBuffer.getMappedRange());
      const ms = Number(t[1] - t[0]) / 1e6;
      this.readBuffer.unmap();
      return ms;
    } finally {
      this.pending = false;
    }
  }

  destroy() {
    this.querySet.destroy();
    this.resolveBuffer.destroy();
    this.readBuffer.destroy();
  }
}

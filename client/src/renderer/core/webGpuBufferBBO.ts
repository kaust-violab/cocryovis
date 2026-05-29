import { WebGpuBuffer } from "./webGpuBuffer";
import {
  BufferBackedObject,
  ArrayOfBufferBackedObjects,
  type DecodedBuffer,
  type Descriptors,
  nextAlign,
  structSize,
  structAlign,
} from "buffer-backed-object";

function descriptorToArrayBufferSize(
  descriptor: Descriptors,
  align: number,
  length: number = 1
): number {
  return nextAlign(structSize(descriptor), align) * length;
}

export abstract class WebGpuBufferBBO<
  T extends Descriptors,
> extends WebGpuBuffer {
  protected readonly arrayBuffer: ArrayBuffer;
  protected readonly bufferObject: DecodedBuffer<T>;
  protected dirty: boolean = true;
  readonly alignment: number;

  protected constructor(
    device: GPUDevice,
    descriptor: T,
    label: string,
    { align = 4 }: { align?: number } = {}
  ) {
    const size = descriptorToArrayBufferSize(descriptor, align);
    super(device, size, label);

    this.alignment = align;
    this.arrayBuffer = new ArrayBuffer(size);
    this.bufferObject = BufferBackedObject(this.arrayBuffer, descriptor, {
      align: align,
    });
  }

  set(params: Partial<DecodedBuffer<T>>) {
    this.dirty = true;
    Object.assign(this.bufferObject, params);
  }

  get params(): Readonly<DecodedBuffer<T>> {
    return this.bufferObject;
  }

  override updateBuffer() {
    if (!this.dirty || this.destroyed) {
      return;
    }
    this.device.queue.writeBuffer(this.buffer, 0, this.arrayBuffer);
    this.dirty = false;
  }
}

export abstract class WebGpuBufferBBOArray<
  T extends Descriptors,
> extends WebGpuBuffer {
  protected arrayBuffer: ArrayBuffer;
  protected bufferObject: Array<DecodedBuffer<T>>;
  protected readonly descriptor: T;
  protected dirty: boolean = true;
  protected arrayLength: number = 0;
  readonly alignment: number;

  protected constructor(
    device: GPUDevice,
    descriptor: T,
    label: string,
    length: number,
    { align }: { align?: number } = {}
  ) {
    if (align === undefined) {
      align = structAlign(descriptor);
    }
    const size = descriptorToArrayBufferSize(descriptor, align, length);
    super(device, size, label);

    this.arrayLength = length;
    this.descriptor = descriptor;
    this.arrayBuffer = new ArrayBuffer(size);
    this.alignment = align;
    this.bufferObject = ArrayOfBufferBackedObjects(
      this.arrayBuffer,
      descriptor,
      {
        length: length,
        align: align,
      }
    );
  }

  get length(): number {
    return this.arrayLength;
  }

  set(index: number, params: Partial<DecodedBuffer<T>>) {
    this.dirty = true;
    if (index < 0 || index >= this.arrayLength) {
      throw new Error("Index out of bounds");
    }
    Object.assign(this.bufferObject[index], params);
  }

  get(index: number): Readonly<DecodedBuffer<T>> {
    const object = this.bufferObject[index] as
      | Readonly<DecodedBuffer<T>>
      | undefined;
    if (object === undefined) {
      throw new Error("Index out of bounds");
    }
    return object;
  }

  setLength(length: number) {
    if (length === this.arrayLength) {
      return;
    }
    const size = descriptorToArrayBufferSize(
      this.descriptor,
      this.alignment,
      length
    );
    const newArrayBuffer = new ArrayBuffer(size);
    const src = new Uint8Array(this.arrayBuffer);
    const dst = new Uint8Array(newArrayBuffer);
    dst.set(src.subarray(0, Math.min(src.length, dst.length)));

    this.arrayLength = length;
    this.arrayBuffer = newArrayBuffer;
    this.bufferObject = ArrayOfBufferBackedObjects(
      this.arrayBuffer,
      this.descriptor,
      {
        length,
        align: this.alignment,
      }
    );
    this.dirty = true;
  }

  override updateBuffer(): boolean {
    if (!this.dirty || this.destroyed) {
      return false;
    }
    if (this.buffer.size !== this.arrayBuffer.byteLength) {
      this.buffer.destroy();
      this.buffer = this.createBuffer(this.arrayBuffer.byteLength);
    }
    this.device.queue.writeBuffer(this.buffer, 0, this.arrayBuffer);
    this.dirty = false;
    return true;
  }
}

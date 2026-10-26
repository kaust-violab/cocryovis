import { ApiError } from "./error-handler";
import type GPUResourcesManager from "./gpu-resources-manager";
import TaskQueue, { Task } from "./task-queue";

export abstract class GPUTask<T = unknown> extends Task<T> {
  protected gpuManager: GPUResourcesManager;
  protected gpuId: number | null = null;

  constructor(userId: number, gpuManager: GPUResourcesManager) {
    super(userId);
    this.gpuManager = gpuManager;
  }

  override reserveResources(): boolean | Promise<boolean> {
    try {
      this.acquireGPU();
      return true;
    } catch {
      return false;
    }
  }

  override onEnd(): void | Promise<void> {
    this.releaseGPU();
  }

  override canRun(): boolean {
    return this.gpuManager.isGpuAvailable();
  }

  protected acquireGPU(): number {
    const gpuId = this.gpuManager.requestGPU();
    if (gpuId === null) {
      throw new ApiError(503, "No available GPU resources.");
    }
    this.gpuId = gpuId;
    return gpuId;
  }

  protected releaseGPU(): void {
    if (this.gpuId !== null) {
      this.gpuManager.releaseGPU(this.gpuId);
      this.gpuId = null;
    }
  }
}

export default class GPUTaskHandler {
  private taskQueue: TaskQueue;
  private config: AppConfig;
  readonly gpuResourcesManager: GPUResourcesManager;

  constructor(config: AppConfig, gpuResourcesManager: GPUResourcesManager) {
    this.config = config;
    this.gpuResourcesManager = gpuResourcesManager;
    this.taskQueue = new TaskQueue(this.gpuResourcesManager.totalGPUs);
  }

  isTaskRunning() {
    return this.taskQueue.hasActiveTask;
  }

  canRunTask() {
    return this.taskQueue.size < this.config.gpuQueueSize;
  }

  async queueGPUTask<T>(task: Task<T>) {
    if (!this.canRunTask()) {
      throw new ApiError(
        400,
        "Failed Attempt to start inference: Too many tasks in queue or GPU not ready."
      );
    }
    return await this.taskQueue.enqueue(task);
  }
}

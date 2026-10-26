import Utils from "./utils";

export default class GPUResourcesManager {
  private gpuData: GPUData[] = [];
  private availableGpus: Set<number> = new Set<number>();

  private constructor() {
    // Private constructor to enforce the use of the async create method
  }

  static async create(): Promise<GPUResourcesManager> {
    const manager = new GPUResourcesManager();
    try {
      const gpuDataJson = await Utils.runPythonScriptWithOutput(
        "get-gpu-data.py",
        []
      );
      manager.gpuData = JSON.parse(gpuDataJson) as GPUData[];
      if (manager.gpuData.length === 0) {
        console.warn(
          "No GPU devices found, GPU functionality will be disabled."
        );
      } else {
        console.log("GPU Data:", manager.gpuData);
      }
      manager.availableGpus = new Set(
        manager.gpuData.map((gpu) => gpu.device_id)
      );
      return manager;
    } catch (error) {
      console.error(
        "Error initializing GPUResourcesManager, GPU functionality will be disabled:",
        error
      );
      return manager;
    }
  }

  get totalGPUs() {
    return this.gpuData.length;
  }

  get freeGPUs() {
    return this.availableGpus.size;
  }

  isGpuAvailable() {
    return this.availableGpus.size > 0;
  }

  requestGPU(): number | null {
    for (const gpuId of this.availableGpus) {
      this.availableGpus.delete(gpuId);
      return gpuId;
    }
    return null;
  }

  releaseGPU(gpuId: number): void {
    this.availableGpus.add(gpuId);
  }
}

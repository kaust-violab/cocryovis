import { type PublicUser } from "../models/user";

declare module "express-session" {
  interface SessionData {
    user?: PublicUser;
  }
}

declare global {
  interface CommonVolumeSettings {
    name: string;
    sizeX: number;
    sizeY: number;
    sizeZ: number;
    skipBytes: number;
    isLittleEndian: boolean;
    isSigned: boolean;
    addValue: number;
    bytesPerVoxel: number;
    usedBits: number;
  }
  type RequireFields<T, K extends keyof T> = Partial<T> & Required<Pick<T, K>>;

  interface GPUData {
    device_id: number;
    device_name: string;
  }
  interface AppConfig {
    idleSessionExpirationMin: number;
    tempPath: string;
    cookieName: string;
    cleanTempOnStartup: boolean;
    dataPath: string;
    maxVolumeChannels: number;
    safeMode: boolean;
    logPath: string;
    ilastikQueueSize: number;
    gpuQueueSize: number;
    compressionLevel: number;
    python: string;
    demoProjectIndex?: number;
  }
}

export {};

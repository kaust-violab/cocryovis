export class LockBlockedError extends Error {
  declare instanceId: number;
  declare instanceName: string;

  constructor(message: string, instanceId: number, instanceName: string) {
    super(message);
    this.name = "LockBlockedError";
    this.instanceId = instanceId;
    this.instanceName = instanceName;
  }
}

export class WriteLock {
  #instanceId: number;
  #connections: string[] | null = null;
  #lockManager: WriteLockManager;
  #active = false;

  constructor(
    instanceId: number,
    connections: string[] | null,
    lockManager: WriteLockManager
  ) {
    this.#instanceId = instanceId;
    this.#connections = connections === null ? null : Array.from(connections);
    this.#lockManager = lockManager;
  }

  get instanceId() {
    return this.#instanceId;
  }

  get connections() {
    return this.#connections;
  }

  get lockManager() {
    return this.#lockManager;
  }

  requestLock(): this | null {
    if (this.#active) {
      console.error("Lock already active");
      return null;
    }

    try {
      if (this.isLockBlocked()) {
        throw new LockBlockedError(
          `Instance of ${this.#lockManager.instanceName} with id ${String(
            this.#instanceId
          )} is currently locked due to it being a part of ongoing operation.`,
          this.#instanceId,
          this.#lockManager.instanceName
        );
      }

      let instanceLocks = this.#lockManager.locks.get(this.#instanceId);
      if (instanceLocks === undefined) {
        instanceLocks = new Set<WriteLock>();
        this.#lockManager.locks.set(this.#instanceId, instanceLocks);
      }
      instanceLocks.add(this);

      if (this.#connections !== null) {
        let instanceConnectionLocks = this.#lockManager.connectionLocks.get(
          this.#instanceId
        );
        if (instanceConnectionLocks === undefined) {
          instanceConnectionLocks = new Map<string, Set<WriteLock>>();
          this.#lockManager.connectionLocks.set(
            this.#instanceId,
            instanceConnectionLocks
          );
        }
        for (const lockConnection of this.#connections) {
          let connectionLocks = instanceConnectionLocks.get(lockConnection);
          if (connectionLocks === undefined) {
            connectionLocks = new Set<WriteLock>();
            instanceConnectionLocks.set(lockConnection, connectionLocks);
          }
          connectionLocks.add(this);
        }
      }

      this.#active = true;
      return this;
    } catch (error) {
      if (!(error instanceof LockBlockedError)) {
        this.removeLock();
      }
      throw error;
    }
  }

  removeLock() {
    const instanceLocks = this.#lockManager.locks.get(this.#instanceId);
    if (instanceLocks !== undefined) {
      instanceLocks.delete(this);
      if (instanceLocks.size === 0) {
        this.#lockManager.locks.delete(this.#instanceId);
      }
    }

    if (this.#connections !== null) {
      const connectionLocks = this.#lockManager.connectionLocks.get(
        this.#instanceId
      );
      if (connectionLocks !== undefined) {
        for (const connection of this.#connections) {
          const connectionLockSet = connectionLocks.get(connection);
          if (connectionLockSet === undefined) {
            continue;
          }
          connectionLockSet.delete(this);
          if (connectionLockSet.size === 0) {
            connectionLocks.delete(connection);
          }
        }
        if (connectionLocks.size === 0) {
          this.#lockManager.connectionLocks.delete(this.#instanceId);
        }
      }
    }
  }

  isLockBlocked(): boolean {
    return this.#lockManager.isLockBlocked(this.instanceId, this.connections);
  }
}

export class WriteMultiLock {
  #writeLocks: WriteLock[];

  constructor(writeLocks: WriteLock[]) {
    this.#writeLocks = writeLocks;
  }

  requestLocks(): this {
    this.#writeLocks.forEach((writeLock) => {
      if (writeLock.isLockBlocked()) {
        throw new LockBlockedError(
          `Instance of ${writeLock.lockManager.instanceName} with id ${String(writeLock.instanceId)} is currently locked due to it being a part of ongoing operation.`,
          writeLock.instanceId,
          writeLock.lockManager.instanceName
        );
      }
    });
    this.#writeLocks.forEach((writeLock) => {
      writeLock.requestLock();
    });
    return this;
  }

  removeLocks() {
    this.#writeLocks.forEach((writeLock) => {
      writeLock.removeLock();
    });
  }

  static withWriteMultiLock<T>(
    multilock: WriteMultiLock,
    operation: () => Promise<T>
  ) {
    multilock.requestLocks();

    void operation().finally(() => {
      multilock.removeLocks();
    });
  }
}

export default class WriteLockManager {
  #locks = new Map<number, Set<WriteLock>>();
  #connectionLocks = new Map<number, Map<string, Set<WriteLock>>>();

  #instanceName: string;

  constructor(instanceName: string) {
    this.#instanceName = instanceName;

    Object.preventExtensions(this);
  }

  get locks() {
    return this.#locks;
  }
  get connectionLocks() {
    return this.#connectionLocks;
  }
  get instanceName() {
    return this.#instanceName;
  }

  isLocked(instanceId: number): boolean {
    const instanceLocks = this.#locks.get(instanceId);
    return instanceLocks !== undefined && instanceLocks.size > 0;
  }

  hasLockedConnection(instanceId: number, connection: string): boolean {
    const instanceConnectionLocks = this.#connectionLocks.get(instanceId);
    if (instanceConnectionLocks === undefined) return false;

    const connectionLocks = instanceConnectionLocks.get(connection);
    if (connectionLocks === undefined) return false;

    return connectionLocks.size > 0;
  }

  isLockBlocked(
    instanceId: number,
    lockConnections: string[] | null = null
  ): boolean {
    if (lockConnections == null) {
      return this.isLocked(instanceId);
    } else {
      return lockConnections.some((l) =>
        this.hasLockedConnection(instanceId, l)
      );
    }
  }

  requestLock(
    instanceId: number,
    connections: string[] | null = null
  ): WriteLock | null {
    return new WriteLock(instanceId, connections, this).requestLock();
  }

  generateLockInstance(
    instanceId: number,
    connections: string[] | null = null
  ): WriteLock {
    return new WriteLock(instanceId, connections, this);
  }
}

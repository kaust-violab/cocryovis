// @ts-check

export class LockBlockedError extends Error {
  /**
   * @param {string} message
   * @param {number} instanceId
   * @param {string} instanceName
   */
  constructor(message, instanceId, instanceName) {
    super(message);
    this.name = "LockBlockedError";
    this.instanceId = instanceId;
    this.instanceName = instanceName;
  }
}

export class WriteLock {
  /** @type {number} */ #instanceId;
  /** @type {string[]?} */ #connections = null;
  /** @type {WriteLockManager} */ #lockManager;
  /** @type {boolean} */ #active = false;

  /**
   * @param {number} instanceId
   * @param {string[]?} connections
   * @param {WriteLockManager} lockManager
   */
  constructor(instanceId, connections, lockManager) {
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

  /**
   * @returns {WriteLock | null}
   */
  requestLock() {
    if (this.#active) {
      console.error("Lock already active");
      return null;
    }

    try {
      if (this.isLockBlocked()) {
        throw new LockBlockedError(
          `Instance of ${this.#lockManager.instanceName} with id ${
            this.#instanceId
          } is currently locked due to it being a part of ongoing operation.`,
          this.#instanceId,
          this.#lockManager.instanceName
        );
      }

      let instanceLocks = this.#lockManager.locks.get(this.#instanceId);
      if (instanceLocks === undefined) {
        instanceLocks = new Set();
        this.#lockManager.locks.set(this.#instanceId, instanceLocks);
      }
      instanceLocks.add(this);

      if (this.#connections !== null) {
        let instanceConnectionLocks = this.#lockManager.connectionLocks.get(
          this.#instanceId
        );
        if (instanceConnectionLocks === undefined) {
          instanceConnectionLocks = new Map();
          this.#lockManager.connectionLocks.set(
            this.#instanceId,
            instanceConnectionLocks
          );
        }
        for (const lockConnection of this.#connections) {
          let connectionLocks = instanceConnectionLocks.get(lockConnection);
          if (connectionLocks === undefined) {
            connectionLocks = new Set();
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

  /**
   * @returns {boolean}
   */
  isLockBlocked() {
    return this.#lockManager.isLockBlocked(this.instanceId, this.connections);
  }
}

export class WriteMultiLock {
  /** @type {WriteLock[]} */ #writeLocks;

  /**
   * @param {WriteLock[]} writeLocks
   */
  constructor(writeLocks) {
    this.#writeLocks = writeLocks;
  }

  /**
   * @returns {WriteMultiLock}
   */
  requestLocks() {
    this.#writeLocks.forEach((writeLock) => {
      if (writeLock.isLockBlocked()) {
        throw new LockBlockedError(
          `Instance of ${writeLock.lockManager.instanceName} with id ${writeLock.instanceId} is currently locked due to it being a part of ongoing operation.`,
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

  /**
   * @template T
   * @param {WriteMultiLock} multilock
   * @param {() => Promise<T>} operation
   */
  static withWriteMultiLock(multilock, operation) {
    multilock.requestLocks();

    operation().finally(() => {
      multilock.removeLocks();
    });
  }
}

export default class WriteLockManager {
  /** @type {Map<number, Set<WriteLock>>} */ #locks = new Map();
  /**
   * @type {Map<number, Map<string, Set<WriteLock>>>}
   */
  #connectionLocks = new Map();

  /** @type {string} */ #instanceName;

  /**
   * @param {string} instanceName
   */
  constructor(instanceName) {
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

  /**
   * @param {number} instanceId
   * @returns {boolean}
   */
  isLocked(instanceId) {
    const instanceLocks = this.#locks.get(instanceId);
    return instanceLocks !== undefined && instanceLocks.size > 0;
  }

  /**
   * @param {number} instanceId
   * @param {string} connection
   * @returns {boolean}
   */
  hasLockedConnection(instanceId, connection) {
    const instanceConnectionLocks = this.#connectionLocks.get(instanceId);
    if (instanceConnectionLocks === undefined) return false;

    const connectionLocks = instanceConnectionLocks.get(connection);
    if (connectionLocks === undefined) return false;

    return connectionLocks.size > 0;
  }

  /**
   * @param {number} instanceId
   * @param {string[]?} lockConnections
   * @returns {boolean}
   */
  isLockBlocked(instanceId, lockConnections = null) {
    if (lockConnections == null) {
      return this.isLocked(instanceId);
    } else {
      return lockConnections.some((l) =>
        this.hasLockedConnection(instanceId, l)
      );
    }
  }

  /**
   * @param {number} instanceId
   * @param {string[]?} connections
   * @returns {WriteLock}
   */
  requestLock(instanceId, connections = null) {
    return new WriteLock(instanceId, connections, this).requestLock();
  }

  /**
   * @param {number} instanceId
   * @param {string[]?} connections
   * @returns {WriteLock}
   */
  generateLockInstance(instanceId, connections = null) {
    return new WriteLock(instanceId, connections, this);
  }
}

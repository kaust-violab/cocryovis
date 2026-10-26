// @ts-check

import { Prisma } from "@prisma/client";

import WriteLockManager, {
  WriteMultiLock,
} from "../tools/write-lock-manager";
import { MissingResourceError } from "../tools/error-handler";
import prismaManager from "../tools/prisma-manager";

/**
 * @template T
 * @param {Prisma.TransactionClient | undefined} client
 * @param {(tx: Prisma.TransactionClient) => Promise<T>} callback
 * @param {{ maxWait?: number, timeout?: number, isolationLevel?: Prisma.TransactionIsolationLevel }} [options]
 * @returns {Promise<T>}
 */
export async function withTransaction(
  client,
  callback,
  options = { timeout: 6000 }
) {
  if (client !== undefined) {
    return await callback(client);
  }

  return prismaManager.db.$transaction(async (tx) => {
    return await callback(tx);
  }, options);
}

export default class DatabaseModel {
  /**
   * @constant
   * @type {string}
   */
  static modelName = "";
  /** @type {WriteLockManager?} */ static lockManager = null;

  /**
   * @returns {any}
   */
  static get db() {
    throw new Error("Method not implemented");
  }

  /**
   * @param {number} id
   * @returns {Promise<object>}
   */
  static async getById(id) {
    const entry = await this.db.findUniqueOrThrow({
      where: { id: id },
    });
    if (entry === null) {
      throw MissingResourceError.fromId(id, this.modelName);
    }
    return entry;
  }

  /**
   * @param {number[]} ids
   * @returns {Promise<object[]>}
   */
  static async getByIds(ids) {
    if (ids.length === 0) {
      return [];
    }
    const entries = await this.db.findMany({
      where: {
        id: {
          in: ids,
        },
      },
    });
    return entries;
  }

  /**
   * @param {...*} _var_args
   * @returns {Promise<object>}
   */
  static async create(..._var_args) {
    throw new Error("Method not implemented");
  }

  /**
   * @param {number} id
   * @param {object} changes
   * @param {object} include
   * @returns {Promise<object>}
   */
  static async update(id, changes, include = null) {
    return this.withWriteLock(id, null, () => {
      try {
        return this.db.update({
          where: { id: id },
          data: changes,
          include: include,
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
          throw MissingResourceError.fromId(id, this.modelName);
        }
        throw error;
      }
    });
  }

  /**
   * @param {number} id
   * @returns {Promise<object>}
   */
  static async del(id) {
    return this.withWriteLock(id, null, () => {
      try {
        return this.db.delete({
          where: { id: id },
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
          throw MissingResourceError.fromId(id, this.modelName);
        }
        throw error;
      }
    });
  }

  /**
   * @template T
   * @param {number} id
   * @param {string[]?} connections
   * @param {() => T} operation
   * @param {boolean?} ignore
   * @returns {Promise<T>}
   */
  static async withWriteLock(id, connections, operation, ignore = false) {
    // ignore is a temporary solution, need a better locking system
    if (this.lockManager === null || ignore) return await operation();

    const lockInstance = this.lockManager.requestLock(id, connections);

    try {
      return await operation();
    } finally {
      lockInstance.removeLock();
    }
  }

  /**
   * @template T
   * @param {number[]} ids
   * @param {string[]?} connections
   * @param {() => T} operation
   * @returns {Promise<T>}
   */
  static async withWriteLocks(ids, connections, operation) {
    if (this.lockManager === null || ids.length === 0) return await operation();

    const locks = ids.map((id) =>
      this.lockManager.generateLockInstance(id, connections)
    );

    const multiLock = new WriteMultiLock(locks).requestLocks();

    try {
      return await operation();
    } finally {
      multiLock.removeLocks();
    }
  }
}

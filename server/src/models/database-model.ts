import { Prisma } from "@prisma/client";

import type WriteLockManager from "../tools/write-lock-manager";
import { WriteMultiLock } from "../tools/write-lock-manager";
import { MissingResourceError } from "../tools/error-handler";
import prismaManager from "../tools/prisma-manager";

export async function withTransaction<T>(
  client: Prisma.TransactionClient | undefined,
  callback: (tx: Prisma.TransactionClient) => Promise<T>,
  options: {
    maxWait?: number;
    timeout?: number;
    isolationLevel?: Prisma.TransactionIsolationLevel;
  } = { timeout: 6000 }
): Promise<T> {
  if (client !== undefined) {
    return await callback(client);
  }

  return prismaManager.db.$transaction(async (tx) => {
    return await callback(tx);
  }, options);
}

/**
 * Minimal shape of the Prisma delegate used by the generic DatabaseModel methods.
 * Subclasses override `db` with a concrete Prisma delegate.
 */
interface GenericModelDelegate {
  findUniqueOrThrow(args: { where: { id: number } }): Promise<unknown>;
  findMany(args: { where: { id: { in: number[] } } }): Promise<unknown[]>;
  update(args: {
    where: { id: number };
    data: object;
    include: object | null;
  }): Promise<unknown>;
  delete(args: { where: { id: number } }): Promise<unknown>;
}

export default class DatabaseModel {
  static modelName = "";
  static lockManager: WriteLockManager | null = null;

  static get db(): unknown {
    throw new Error("Method not implemented");
  }

  static async getById(id: number): Promise<unknown> {
    const entry = await (this.db as GenericModelDelegate).findUniqueOrThrow({
      where: { id: id },
    });
    if (entry === null) {
      throw MissingResourceError.fromId(id, this.modelName);
    }
    return entry;
  }

  static async getByIds(ids: number[]): Promise<unknown[]> {
    if (ids.length === 0) {
      return [];
    }
    const entries = await (this.db as GenericModelDelegate).findMany({
      where: {
        id: {
          in: ids,
        },
      },
    });
    return entries;
  }

  static create(..._var_args: unknown[]): Promise<unknown> {
    return Promise.reject(new Error("Method not implemented"));
  }

  static async update(
    id: number,
    changes: object,
    include: object | null = null
  ): Promise<unknown> {
    return this.withWriteLock(id, null, async () => {
      try {
        return await (this.db as GenericModelDelegate).update({
          where: { id: id },
          data: changes,
          include: include,
        });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2025"
        ) {
          throw MissingResourceError.fromId(id, this.modelName);
        }
        throw error;
      }
    });
  }

  static async del(id: number): Promise<unknown> {
    return this.withWriteLock(id, null, async () => {
      try {
        return await (this.db as GenericModelDelegate).delete({
          where: { id: id },
        });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2025"
        ) {
          throw MissingResourceError.fromId(id, this.modelName);
        }
        throw error;
      }
    });
  }

  static async withWriteLock<T>(
    id: number,
    connections: string[] | null,
    operation: () => T | Promise<T>,
    ignore: boolean | null = false
  ): Promise<T> {
    // ignore is a temporary solution, need a better locking system
    if (this.lockManager === null || ignore) return await operation();

    const lockInstance = this.lockManager.requestLock(id, connections);

    try {
      return await operation();
    } finally {
      lockInstance?.removeLock();
    }
  }

  static async withWriteLocks<T>(
    ids: number[],
    connections: string[] | null,
    operation: () => T | Promise<T>
  ): Promise<T> {
    const lockManager = this.lockManager;
    if (lockManager === null || ids.length === 0) return await operation();

    const locks = ids.map((id) =>
      lockManager.generateLockInstance(id, connections)
    );

    const multiLock = new WriteMultiLock(locks).requestLocks();

    try {
      return await operation();
    } finally {
      multiLock.removeLocks();
    }
  }
}

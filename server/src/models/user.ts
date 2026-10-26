// @ts-check

import DatabaseModel, { withTransaction } from "./database-model";
import prismaManager from "../tools/prisma-manager";
import WriteLockManager from "../tools/write-lock-manager";
import { ApiError } from "../tools/error-handler";
import RawVolumeDataFile from "./raw-volume-data-file";
import SparseVolumeDataFile from "./sparse-volume-data-file";
import PseudoVolumeDataFile from "./pseudo-volume-data-file";
import { Prisma } from "@prisma/client";
import bcrypt from "bcrypt";
import { securityConfig } from "../tools/config";

/**
 * @import { publicUser } from "@cocryovis/schemas/user-path-schema"
 * @import z from "zod"
 * @typedef { import("@prisma/client").User } UserDB
 * @typedef {z.infer<publicUser>} PublicUser
 */

export default class User extends DatabaseModel {
  static modelName = "user";
  static lockManager = new WriteLockManager(this.modelName);

  static get db() {
    return prismaManager.db.user;
  }

  /**
   * @param {string} username
   * @param {string} password
   * @returns {Promise<UserDB>}
   */
  static async authenticate(username, password) {
    const user = await User.getByUsername(username);

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) {
      throw new ApiError(401, "Authentication Failed");
    }
    return user;
  }

  /**
   * @param {number} id
   * @returns {Promise<UserDB>}
   */
  static async getById(id) {
    return await super.getById(id);
  }

  /**
   * @param {number[]} ids
   * @returns {Promise<UserDB[]>}
   */
  static async getByIds(ids) {
    return await super.getByIds(ids);
  }

  /**
   * @param {string} username
   * @returns {Promise<UserDB>}
   */
  static async getByUsername(username) {
    let user = await prismaManager.db.user.findUnique({
      where: { username: username },
    });
    if (!user) {
      throw new ApiError(404, `Cannot find User with username ${username}`);
    }
    return user;
  }

  static async getAllUsers() {
    return await prismaManager.db.user.findMany({
      omit: {
        passwordSalt: true,
        passwordHash: true,
      },
    });
  }

  /**
   * @param {string} password
   * @returns {Promise<{ salt: string, hash: string}>}
   */
  static async encryptPassword(password) {
    const bcryptCost = securityConfig.bcryptCost;
    const passwordSalt = await bcrypt.genSalt(bcryptCost);
    const passwordHash = await bcrypt.hash(password, passwordSalt);
    return { salt: passwordSalt, hash: passwordHash };
  }

  /**
   * @param {string} username
   * @param {string} password
   * @param {string} name
   * @param {string} email
   * @returns {Promise<UserDB>}
   */
  static async create(username, password, name, email) {
    if (!username || username.length === 0) {
      throw new ApiError(400, "Missing username.");
    }
    if (!password || password.length === 0) {
      throw new ApiError(400, "Missing password.");
    }
    const { salt, hash } = await User.encryptPassword(password);

    return await prismaManager.db.user.create({
      data: {
        username: username,
        name: name,
        email: email,
        passwordSalt: salt,
        passwordHash: hash,
      },
    });
  }

  /**
   * @param {number} id
   * @param {import("@prisma/client").Prisma.UserUpdateInput & {password?: string}} changes
   * @returns {Promise<UserDB>}
   */
  static async update(id, changes) {
    if (Object.hasOwn(changes, "password")) {
      const { salt, hash } = await User.encryptPassword(changes.password);
      changes.passwordSalt = salt;
      changes.passwordHash = hash;
      delete changes.password;
    }

    return prismaManager.db.user.update({
      where: { id: id },
      data: changes,
    });
  }

  /**
   * @param {number} id
   * @param {Prisma.TransactionClient | undefined} [client]
   */
  static async del(id, client) {
    return await withTransaction(client, async (tx) => {
      const projectIds = await tx.project.findMany({
        where: { ownerId: id },
        select: { id: true },
      });

      for (const project of projectIds) {
        const newOwner = await tx.projectAccess.findFirst({
          where: {
            projectId: project.id,
            accessLevel: 1,
          },
          select: {
            userId: true,
          },
        });

        if (newOwner) {
          await tx.project.update({
            where: { id: project.id },
            data: { ownerId: newOwner.userId },
          });
        } else {
          await tx.project.delete({
            where: { id: project.id },
          });
        }
      }

      await RawVolumeDataFile.deleteZombies(tx);
      await SparseVolumeDataFile.deleteZombies(tx);
      await PseudoVolumeDataFile.deleteZombies(tx);

      return tx.user.delete({
        where: { id: id },
      });
    });
  }

  /**
   * @param {UserDB} user
   * @returns {PublicUser}
   */
  static toPublic(user) {
    return {
      id: user.id,
      username: user.username,
      name: user.name,
      email: user.email,
      admin: user.admin,
    };
  }
}

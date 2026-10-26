import DatabaseModel, { withTransaction } from "./database-model";
import prismaManager from "../tools/prisma-manager";
import WriteLockManager from "../tools/write-lock-manager";
import { ApiError } from "../tools/error-handler";
import RawVolumeDataFile from "./raw-volume-data-file";
import SparseVolumeDataFile from "./sparse-volume-data-file";
import PseudoVolumeDataFile from "./pseudo-volume-data-file";
import type { Prisma, User as UserDB } from "@prisma/client";
import bcrypt from "bcrypt";
import { securityConfig } from "../tools/config";
import type { publicUser } from "@cocryovis/schemas/user-path-schema";
import type z from "zod";

export type { UserDB };
export type PublicUser = z.infer<typeof publicUser>;

export default class User extends DatabaseModel {
  static override modelName = "user";
  static override lockManager = new WriteLockManager(this.modelName);

  static override get db() {
    return prismaManager.db.user;
  }

  static async authenticate(
    username: string,
    password: string
  ): Promise<UserDB> {
    const user = await User.getByUsername(username);

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) {
      throw new ApiError(401, "Authentication Failed");
    }
    return user;
  }

  static override async getById(id: number): Promise<UserDB> {
    return (await super.getById(id)) as UserDB;
  }

  static override async getByIds(ids: number[]): Promise<UserDB[]> {
    return (await super.getByIds(ids)) as UserDB[];
  }

  static async getByUsername(username: string): Promise<UserDB> {
    const user = await prismaManager.db.user.findUnique({
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

  static async encryptPassword(
    password: string
  ): Promise<{ salt: string; hash: string }> {
    const bcryptCost = securityConfig.bcryptCost;
    const passwordSalt = await bcrypt.genSalt(bcryptCost);
    const passwordHash = await bcrypt.hash(password, passwordSalt);
    return { salt: passwordSalt, hash: passwordHash };
  }

  static override async create(
    username: string,
    password: string,
    name: string,
    email: string
  ): Promise<UserDB> {
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

  static override async update(
    id: number,
    changes: Prisma.UserUpdateInput & { password?: string }
  ): Promise<UserDB> {
    if (Object.hasOwn(changes, "password")) {
      if (changes.password === undefined) {
        throw new ApiError(400, "Missing password.");
      }
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

  static override async del(id: number, client?: Prisma.TransactionClient) {
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

  static toPublic(user: UserDB): PublicUser {
    return {
      id: user.id,
      username: user.username,
      name: user.name,
      email: user.email,
      admin: user.admin,
    };
  }
}

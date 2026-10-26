import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";
import { securityConfig } from "../src/tools/config";

const prisma = new PrismaClient();

async function main() {
  const existing = await prisma.user.findFirst({
    where: { admin: true },
  });

  if (existing) {
    console.log("✅ Admin already exists");
    return;
  }

  const isProduction = process.env.NODE_ENV === "production";

  let username = process.env.ADMIN_USERNAME;
  let password = process.env.ADMIN_PASSWORD;

  if (isProduction) {
    if (!username || !password) {
      throw new Error(
        "ADMIN_USERNAME and ADMIN_PASSWORD must be set in production"
      );
    }
  }

  if (!username || !password) {
    console.warn(
      "⚠️ ADMIN_USERNAME or ADMIN_PASSWORD not set — using development defaults"
    );
    username = username ?? "admin";
    password = password ?? "admin123";
  }

  const bcryptCost = securityConfig.bcryptCost;
  const passwordSalt = await bcrypt.genSalt(bcryptCost);
  const passwordHash = await bcrypt.hash(password, passwordSalt);

  // If such username already exists (e.g. from a previous seed run), fail
  if (await prisma.user.findUnique({ where: { username } })) {
    throw new Error(
      `Error while creating an admin with username "${username}" already exists`
    );
  }

  const admin = await prisma.user.create({
    data: {
      username,
      name: "Administrator",
      email: `${username}@example.com`,
      passwordSalt,
      passwordHash,
      admin: true,
    },
  });

  console.log("Admin created:");
  console.log({
    id: admin.id,
    username: admin.username,
    password,
  });
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

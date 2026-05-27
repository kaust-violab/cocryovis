import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";
import { securityConfig } from "../../src/tools/config.mjs";
import { faker } from "@faker-js/faker";

const prisma = new PrismaClient();

async function createUser(
  name: string,
  username: string,
  email: string,
  password: string
) {
  const bcryptCost = securityConfig.bcryptCost;
  const existing = await prisma.user.findUnique({
    where: { username },
  });

  if (existing) {
    console.log(`↩️ ${username} already exists`);
    return;
  }

  const passwordSalt = await bcrypt.genSalt(bcryptCost);
  const passwordHash = await bcrypt.hash(password, passwordSalt);

  await prisma.user.create({
    data: {
      username: username,
      name: name,
      email: email,
      passwordSalt,
      passwordHash,
      admin: false,
    },
  });

  console.log(`✅ Created ${username}`);
}

function createRandomUser() {
  const name = faker.person.fullName();
  const username = faker.internet.username({
    firstName: name,
  });
  const email = faker.internet.email({
    firstName: name,
  });
  const password = "password";
  return {
    name: name,
    username: username,
    email: email,
    password: password,
  };
}

async function main() {
  try {
    await createUser("User", "User", "user@example.com", "password");
  } catch (error) {
    console.error("Error creating test user:", error);
  }

  const users = faker.helpers.multiple(createRandomUser, {
    count: 10,
  });

  for (const { name, username, email, password } of users) {
    try {
      await createUser(name, username, email, password);
    } catch (error) {
      console.error(`Error creating ${username}:`, error);
    }
  }
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

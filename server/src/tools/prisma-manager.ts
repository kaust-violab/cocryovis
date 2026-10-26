// @ts-check

import { PrismaClient, Prisma } from "@prisma/client";

class PrismaManager {
  constructor() {
    this.db = new PrismaClient({
      // log: ["query"],
      transactionOptions: {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5000,
        timeout: 10000,
      },
    });

    // this.db.$on("query", (e) => {
    //     console.log("Query: " + e.query);
    //     console.log("Params: " + e.params);
    //     console.log("Duration: " + e.duration + "ms");
    // });
  }

  /**
   * @returns {PrismaManager}
   */
  static getInstance() {
    if (!this.instance) {
      this.instance = new this();
    }
    return this.instance;
  }
}

const prismaManager = PrismaManager.getInstance();

export default prismaManager;

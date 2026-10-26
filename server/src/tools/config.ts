import { readFileSync } from "fs";

export const securityConfig: { bcryptCost: number } = {
  bcryptCost: parseInt(process.env.BCRYPT_COST ?? "10", 10),
};

class Config {
  declare static instance: Config | undefined;

  config: AppConfig;

  constructor() {
    this.config = JSON.parse(
      readFileSync("./config.json", "utf8")
    ) as AppConfig;
  }

  static getInstance(): Config {
    if (!this.instance) {
      this.instance = new this();
    }
    return this.instance;
  }
}

const appConfig = Config.getInstance().config;

export default appConfig;

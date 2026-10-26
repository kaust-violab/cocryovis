import { readFileSync } from "fs";

/**
 * @type {{ bcryptCost: number }}
 */
export const securityConfig = {
  bcryptCost: parseInt(process.env.BCRYPT_COST ?? "10", 10),
};

class Config {
  /**
   * @type {AppConfig}
   */
  config;

  constructor() {
    /**
     * @type {AppConfig}
     */
    this.config = JSON.parse(readFileSync("./config.json", "utf8"));
  }

  static getInstance() {
    if (!this.instance) {
      this.instance = new this();
    }
    return this.instance;
  }
}

const appConfig = Config.getInstance().config;

export default appConfig;

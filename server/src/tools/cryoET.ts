// @ts-check

import Utils from "./utils";

/**
 * @import z from "zod"
 * @import { tomogramSchema } from "@cocryovis/schemas/cryoEt-path-schema"
 */

/**
 * Fetch cryoET tomogram metadata by id
 * @param {number} id
 * @returns {Promise<z.infer<tomogramSchema>>}
 */
export async function fetchCtyoETTomogramMetadata(id) {
  let errOutput = "";

  try {
    let output = "";
    await Utils.runPythonScript(
      "fetch-cryoET-tomogram_by_id.py",
      [id.toString()],
      (value) => (output += value),
      (value) => (errOutput += value)
    );
    return JSON.parse(output);
  } catch {
    throw new Error("Failed to fetch cryoET tomogram metadata: " + errOutput);
  }
}

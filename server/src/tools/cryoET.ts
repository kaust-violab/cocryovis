import Utils from "./utils";
import type z from "zod";
import type { tomogramSchema } from "@cocryovis/schemas/cryoEt-path-schema";

/**
 * Fetch cryoET tomogram metadata by id
 */
export async function fetchCtyoETTomogramMetadata(
  id: number
): Promise<z.infer<typeof tomogramSchema>> {
  let errOutput = "";

  try {
    let output = "";
    await Utils.runPythonScript(
      "fetch-cryoET-tomogram_by_id.py",
      [id.toString()],
      (value) => (output += value),
      (value) => (errOutput += value)
    );
    return JSON.parse(output) as z.infer<typeof tomogramSchema>;
  } catch {
    throw new Error("Failed to fetch cryoET tomogram metadata: " + errOutput);
  }
}

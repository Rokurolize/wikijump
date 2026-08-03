import fs from "node:fs/promises";
import path from "node:path";

import { publishBytesNoReplace } from "./atomic-no-replace.mjs";

export async function publishListPagesJsonNoReplace(outputPath, value) {
  await fs.mkdir(path.dirname(outputPath), {
    recursive: true,
    mode: 0o700,
  });
  const result = await publishBytesNoReplace(
    outputPath,
    `${JSON.stringify(value, null, 2)}\n`,
    { mode: 0o400 },
  );
  if (result === "exists") {
    const error = new Error(`EEXIST: evidence output already exists: ${outputPath}`);
    error.code = "EEXIST";
    throw error;
  }
}

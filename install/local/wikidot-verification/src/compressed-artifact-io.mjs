import fs from "node:fs/promises";
import { gzip as gzipCallback, gunzip as gunzipCallback, constants as zlibConstants } from "node:zlib";
import { promisify } from "node:util";

const gzip = promisify(gzipCallback);
const gunzip = promisify(gunzipCallback);

export async function readArtifactBytes(filePath) {
  const bytes = await fs.readFile(filePath);
  return String(filePath).endsWith(".gz") ? gunzip(bytes) : bytes;
}

export async function resolveCompressedArtifact(filePath) {
  if (filePath.endsWith(".gz")) return filePath;
  const compressed = `${filePath}.gz`;
  try {
    await fs.access(compressed);
    return compressed;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return filePath;
  }
}

export async function readArtifactText(filePath) {
  return (await readArtifactBytes(filePath)).toString("utf8");
}

export async function readJsonArtifact(filePath) {
  return JSON.parse(await readArtifactText(filePath));
}

export async function readJsonlArtifact(filePath) {
  const text = await readArtifactText(filePath);
  if (!text.trim()) return [];
  return text
    .trimEnd()
    .split(/\r?\n/u)
    .map((line) => JSON.parse(line));
}

export async function readJsonArtifactVariant(filePath) {
  return readJsonArtifact(await resolveCompressedArtifact(filePath));
}

export async function readJsonlArtifactVariant(filePath) {
  return readJsonlArtifact(await resolveCompressedArtifact(filePath));
}

export async function writeGzipText(filePath, text, options = {}) {
  const bytes = await gzip(Buffer.from(text, "utf8"), {
    level: zlibConstants.Z_BEST_COMPRESSION,
    mtime: 0,
  });
  await fs.writeFile(filePath, bytes, { mode: options.mode ?? 0o600 });
}

export async function writeJsonGzip(filePath, value, options = {}) {
  await writeGzipText(filePath, `${JSON.stringify(value, null, 2)}\n`, options);
}

export async function writeJsonlGzip(filePath, rows, options = {}) {
  await writeGzipText(
    filePath,
    rows.map((record) => `${JSON.stringify(record)}\n`).join(""),
    options,
  );
}

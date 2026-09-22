// Optional visual diff.
//
// DOM/computed-style diagnosis is the primary signal; screenshots are
// supplementary and only captured when explicitly requested. Reuses the same
// ImageMagick RMSE normalization as the Wikijump offline browser oracle.

import {execFile as execFileCallback} from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import {promisify} from "node:util";

const execFile = promisify(execFileCallback);

import {screenshot, setViewport} from "./browser-lab.mjs";

export const DEFAULT_VISUAL_RMSE_THRESHOLD = 0.015;

export function parseImageMagickRmse(stderr) {
  const text = String(stderr ?? "").trim();
  const match = /(?:^|\s)([0-9]+(?:\.[0-9]+)?)\s+\(([0-9]+(?:\.[0-9]+)?(?:e[+-]?\d+)?)\)\s*$/iu.exec(text);
  if (!match) throw new Error(`could not parse ImageMagick RMSE: ${text}`);
  const absolute = Number(match[1]);
  const normalized = Number(match[2]);
  if (!Number.isFinite(absolute) || !Number.isFinite(normalized)) {
    throw new Error("ImageMagick RMSE is not finite");
  }
  return {absolute, normalized};
}

export async function comparePngRmse(
  expectedPath,
  actualPath,
  {threshold = DEFAULT_VISUAL_RMSE_THRESHOLD, command = "compare", run = execFile} = {},
) {
  let stderr = "";
  let exitCode = 0;
  try {
    const result = await run(command, ["-metric", "RMSE", expectedPath, actualPath, "null:"]);
    stderr = result.stderr ?? "";
  } catch (error) {
    if (error?.code !== 1) {
      if (error?.code === "ENOENT") throw new Error("visual diff requires ImageMagick `compare`");
      throw error;
    }
    exitCode = 1;
    stderr = error.stderr ?? "";
  }
  const metric = parseImageMagickRmse(stderr);
  return {
    status: metric.normalized <= threshold ? "pass" : "fail",
    metric: "RMSE",
    normalized_rmse: metric.normalized,
    absolute_rmse: metric.absolute,
    threshold,
    image_magick_exit_code: exitCode,
  };
}

// Viewport-sized by default: reference and candidate are different pages, so
// only equal-dimension captures give a meaningful RMSE. Full-page artifacts can
// still be captured separately.
export async function captureVisualPair({
  candidatePage,
  referencePage = null,
  viewports,
  outputDir,
  fullPage = false,
  threshold = DEFAULT_VISUAL_RMSE_THRESHOLD,
}) {
  await fs.mkdir(outputDir, {recursive: true});
  const results = {};
  for (const viewport of viewports) {
    await setViewport(candidatePage, viewport);
    const candidatePath = path.join(outputDir, `candidate-${viewport.id}.png`);
    await screenshot(candidatePage, {path: candidatePath, fullPage});
    let referencePath = null;
    let comparison = null;
    if (referencePage) {
      await setViewport(referencePage, viewport);
      referencePath = path.join(outputDir, `reference-${viewport.id}.png`);
      await screenshot(referencePage, {path: referencePath, fullPage});
      try {
        comparison = await comparePngRmse(referencePath, candidatePath, {threshold});
      } catch (error) {
        comparison = {status: "unavailable", error: String(error.message)};
      }
    }
    results[viewport.id] = {candidate_path: candidatePath, reference_path: referencePath, comparison};
  }
  return results;
}

import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";

const HEX40 = /^[0-9a-f]{40}$/u;

export function resolvePinnedFtmlCheckout({ revision, tree }) {
  if (!HEX40.test(revision) || !HEX40.test(tree)) {
    throw new Error("pinned FTML revision and tree must be full Git object IDs");
  }
  const root = process.env.WIKIJUMP_FTML_CHECKOUT
    ?? path.join(homedir(), ".cargo", "git", "checkouts", "ftml-a724b9bc9f2959c8", revision.slice(0, 7));
  if (!path.isAbsolute(root)) throw new Error("pinned FTML checkout path must be absolute");
  const observed = execFileSync("git", ["-C", root, "rev-parse", "HEAD", "HEAD^{tree}"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim().split(/\s+/u);
  if (observed[0] !== revision || observed[1] !== tree) {
    throw new Error("FTML checkout does not match the pinned revision and tree");
  }
  return root;
}

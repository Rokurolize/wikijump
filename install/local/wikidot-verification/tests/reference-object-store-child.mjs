import { openReferenceObjectStore } from "../src/reference-object-store.mjs";
import fs from "node:fs/promises";

const [root, inputPath] = process.argv.slice(2);
const store = await openReferenceObjectStore(root);
const bytes = await fs.readFile(inputPath);
process.send({ type: "ready" });

function reply(message) {
  process.send(message, (error) => {
    if (error) process.exit(1);
  });
}

process.once("message", async (message) => {
  if (message?.type !== "go") process.exit(2);
  try {
    const result = await store.putBytes(bytes);
    await store.close();
    reply({ type: "result", ...result });
  } catch (error) {
    await store.close().catch(() => {});
    reply({ type: "error", message: error.stack ?? error.message });
  }
});

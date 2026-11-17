import * as fs from 'fs';
import { FluentResource } from "@fluent/bundle";

const input = process.argv[2] || "../fluent";
const output = process.argv[3] || "types";

if (!fs.existsSync(output)) {
  fs.mkdirSync(output, { recursive: true });
}

let combined: Record<string, string> = {};
let locales: Record<string, string> = {};

fs.readdirSync(input).forEach((folder) => {
  const data = fs.readdirSync(`${input}/${folder}`).map((file) => {
    let locale = file.split(".")[0];
    if (!locales[locale]) {
      locales[locale] = locale.replace(/_/g, "-");
    };

    if (!locale.includes("en")) return;

    const files = fs.readFileSync(`${input}/${folder}/${file}`, "utf8");

    return new FluentResource(files).body.flatMap((entry) => {
      if (entry.id.startsWith("-")) return [];
      return [
        entry.id,
        ...Object.keys(entry.attributes).map(key=>`${entry.id}.${key}`),
      ];
    });
  });

  const filterd = data.filter((entry) => entry !== undefined);

  const flat = filterd.flat();

  const unique = [...new Set(flat)];

  unique.forEach((entry) => {
    combined[entry] = "string";
  });
});

locales = Object.fromEntries(
  Object.entries(locales)
    .sort((a,b)=>a[0].localeCompare(b[0], "en", { ignorePunctuation: true }))
)

const types = JSON.stringify(combined, null, 2)
  .replace(/"/g, "")
  .replace(/,/g, "")
  .replace(/(?=\S*['\-\._])([a-zA-Z0-9'\-\._]+)/g, '"$1"');

const langs = JSON.stringify(locales, null, 2)
  .replace(/"/g, "")
  .replace(/:\s*([a-zA-Z0-9'\-\._]+)/g,' = "$1"');

fs.writeFileSync(`${output}/index.ts`, `export interface Locales ${types}\n\nexport enum Langs ${langs}\n`);

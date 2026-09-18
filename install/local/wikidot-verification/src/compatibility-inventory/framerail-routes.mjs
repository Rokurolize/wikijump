import fs from "node:fs/promises";
import path from "node:path";

import {
  extractBalanced,
  importedBinding,
  objectPropertyNames,
} from "./typescript-source.mjs";

const HTTP_METHOD_NAMES = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
];

function toPosix(value) {
  return value.split(path.sep).join("/");
}

function relativeReference(root, absolutePath) {
  const relative = path.relative(root, absolutePath);
  if (
    relative === "" ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`path escapes repository: ${absolutePath}`);
  }
  return toPosix(relative);
}

async function defaultReadAbsoluteText(root, absolutePath) {
  relativeReference(root, absolutePath);
  return fs.readFile(absolutePath, "utf8");
}

async function listFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(target)));
    else if (entry.isFile()) files.push(target);
  }
  return files;
}

function routeSegment(segment) {
  return segment
    .replaceAll(/\[x\+([0-9a-fA-F]{2})\]/gu, (_, hex) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replaceAll(/\[\.\.\.([A-Za-z_][A-Za-z0-9_]*)\]/gu, "{*$1}")
    .replaceAll(/\[([A-Za-z_][A-Za-z0-9_]*)(?:=[^\]]+)?\]/gu, "{$1}");
}

function routePathFromDirectory(routesRoot, directory) {
  const relative = path.relative(routesRoot, directory);
  if (relative === "") return "/";
  return `/${relative.split(path.sep).map(routeSegment).join("/")}`;
}

async function resolveModulePath(root, fromPath, specifier) {
  const base = specifier.startsWith("$lib/")
    ? path.join(root, "framerail/src/lib", specifier.slice("$lib/".length))
    : path.resolve(path.dirname(fromPath), specifier);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.js`,
    path.join(base, "index.ts"),
    path.join(base, "index.js"),
  ];
  for (const candidate of candidates) {
    relativeReference(root, candidate);
    try {
      const metadata = await fs.stat(candidate);
      if (metadata.isFile()) return candidate;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  throw new Error(
    `cannot resolve action registry ${specifier} from ${relativeReference(root, fromPath)}`,
  );
}

function uniqueSortedStrings(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right, "en"));
}

async function resolveNamedActionObject(
  root,
  filePath,
  exportName,
  visited,
  readSource,
) {
  const visitKey = `${filePath}:${exportName}`;
  if (visited.has(visitKey)) throw new Error(`cyclic action registry export: ${visitKey}`);
  visited.add(visitKey);
  const sourceText = await readSource(filePath);
  const declaration = new RegExp(
    `export\\s+const\\s+${exportName}\\s*=\\s*`,
    "u",
  ).exec(sourceText);
  if (!declaration) {
    throw new Error(
      `missing exported action registry ${relativeReference(root, filePath)}#${exportName}`,
    );
  }
  const expressionStart = declaration.index + declaration[0].length;
  if (sourceText[expressionStart] !== "{") {
    throw new Error(
      `action registry ${relativeReference(root, filePath)}#${exportName} is not an object literal`,
    );
  }
  const expression = extractBalanced(sourceText, expressionStart, "{", "}");
  return {
    names: objectPropertyNames(
      expression,
      `${relativeReference(root, filePath)}#${exportName}`,
    ),
    references: [relativeReference(root, filePath)],
  };
}

async function resolveRouteActions(
  root,
  filePath,
  readSource,
  visited = new Set(),
) {
  const sourceText = await readSource(filePath);
  const direct = /export\s+const\s+actions\s*=\s*/u.exec(sourceText);
  if (direct) {
    const expressionStart = direct.index + direct[0].length;
    if (sourceText[expressionStart] === "{") {
      const expression = extractBalanced(sourceText, expressionStart, "{", "}");
      return {
        names: objectPropertyNames(
          expression,
          `${relativeReference(root, filePath)}#actions`,
        ),
        references: [relativeReference(root, filePath)],
      };
    }
    const alias = sourceText
      .slice(expressionStart)
      .match(/^([A-Za-z_$][A-Za-z0-9_$]*)/u)?.[1];
    if (!alias) {
      throw new Error(
        `unsupported actions declaration in ${relativeReference(root, filePath)}`,
      );
    }
    const binding = importedBinding(sourceText, alias);
    if (!binding) {
      throw new Error(
        `unresolved actions alias ${alias} in ${relativeReference(root, filePath)}`,
      );
    }
    const target = await resolveModulePath(root, filePath, binding.specifier);
    const resolved = await resolveNamedActionObject(
      root,
      target,
      binding.imported,
      visited,
      readSource,
    );
    return {
      names: resolved.names,
      references: uniqueSortedStrings([
        relativeReference(root, filePath),
        ...resolved.references,
      ]),
    };
  }
  const reexport =
    /export\s*\{([^}]*\bactions\b[^}]*)\}\s*from\s*["']([^"']+)["']/u.exec(
      sourceText,
    );
  if (reexport) {
    const target = await resolveModulePath(root, filePath, reexport[2]);
    const resolved = await resolveRouteActions(root, target, readSource, visited);
    return {
      names: resolved.names,
      references: uniqueSortedStrings([
        relativeReference(root, filePath),
        ...resolved.references,
      ]),
    };
  }
  return { names: [], references: [] };
}

function serverRouteMethods(sourceText, reference) {
  const methods = HTTP_METHOD_NAMES.filter((method) =>
    new RegExp(
      `export\\s+(?:async\\s+function|const)\\s+${method}\\b`,
      "u",
    ).test(sourceText),
  );
  if (methods.length === 0) {
    throw new Error(`${reference} declares no public HTTP method`);
  }
  return methods;
}

export async function discoverFramerailRouteDescriptors(
  root,
  { readAbsoluteText = null } = {},
) {
  const readSource =
    readAbsoluteText ?? ((filePath) => defaultReadAbsoluteText(root, filePath));
  const routesRoot = path.join(root, "framerail/src/routes");
  const allFiles = await listFiles(routesRoot);
  const routeFiles = allFiles.filter((filePath) =>
    /\+(?:page\.svelte|page\.server\.(?:ts|js)|server\.(?:ts|js))$/u.test(
      filePath,
    ),
  );
  const routes = new Map();
  const actionRecords = [];
  for (const filePath of routeFiles.sort()) {
    const sourceText = await readSource(filePath);
    const directory = path.dirname(filePath);
    const routePath = routePathFromDirectory(routesRoot, directory);
    const reference = relativeReference(root, filePath);
    const directoryReference = relativeReference(root, directory);
    const current = routes.get(routePath);
    if (current && current.directoryReference !== directoryReference) {
      throw new Error(
        `duplicate Framerail route after path decoding: ${routePath}`,
      );
    }
    const route = current ?? {
      directoryReference,
      references: [],
      methods: new Set(),
    };
    route.references.push(reference);
    if (/\+server\.(?:ts|js)$/u.test(filePath)) {
      for (const method of serverRouteMethods(sourceText, reference)) {
        route.methods.add(method);
      }
    } else {
      route.methods.add("GET");
    }
    routes.set(routePath, route);

    if (/\+page\.server\.(?:ts|js)$/u.test(filePath)) {
      const actionRegistry = await resolveRouteActions(root, filePath, readSource);
      for (const actionName of actionRegistry.names) {
        actionRecords.push({
          surfaceId: `framerail-server-action:${routePath}?/${actionName}`,
          kind: "framerail_server_action",
          publicOwner: "framerail",
          publicReference: actionRegistry.references.map(
            (actionReference) => `${actionReference}#action:${actionName}`,
          ),
        });
      }
    }
  }

  const routeRecords = [...routes.entries()].map(([routePath, route]) => ({
    surfaceId: `framerail-route:${routePath}`,
    kind: "framerail_route",
    publicOwner: "framerail",
    publicReference: route.references.map(
      (reference) =>
        `${reference}#methods:${[...route.methods].sort().join(",")}`,
    ),
  }));
  return [...routeRecords, ...actionRecords];
}

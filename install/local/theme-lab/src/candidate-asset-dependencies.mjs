import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {resolveExistingContainedFile} from './package-path.mjs';

const ASSET_NAME_PATTERN = /[0-9a-f]{64}\.(?:css|svg|png|jpe?g|webp|woff2?|ttf|otf|eot)/giu;
const LEGACY_ASSET_PATTERN = /url\(\s*["']?\.\/assets\/([^)\/'"\s]+)["']?\s*\)/giu;
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const assetNames = value => String(value ?? '').match(new RegExp(ASSET_NAME_PATTERN.source, ASSET_NAME_PATTERN.flags)) ?? [];
const legacyAssetNames = value => [...String(value ?? '').matchAll(new RegExp(LEGACY_ASSET_PATTERN.source, LEGACY_ASSET_PATTERN.flags))].map(match=>match[1]);

export function candidateAssetDependencyState({
  portsDir,
  themeDir,
  runtimeSupportCss = '',
  baselineCss = '',
  baseCss = '',
  candidateCss = '',
  candidateSource = '',
  localAssetPathCache = new Map(),
  fileShaCache = new Map(),
}) {
  const theme = path.basename(themeDir);
  const localAssetPath = name => {
    const key = `${theme}\0${name}`;
    if (localAssetPathCache.has(key)) return localAssetPathCache.get(key);
    let resolved = null;
    for (const root of [path.join(themeDir, 'assets'), path.join(portsDir, 'shared-replay-assets'), path.join(themeDir, 'page-assets')]) {
      if(!fs.existsSync(root))continue;
      try {
        resolved = resolveExistingContainedFile(root,name,`candidate asset ${name}`);
        break;
      } catch (error) {
        if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
      }
    }
    localAssetPathCache.set(key, resolved);
    return resolved;
  };
  const fileSha = file => {
    if (!file) return null;
    if (fileShaCache.has(file)) return fileShaCache.get(file);
    const value = digest(fs.readFileSync(file));
    fileShaCache.set(file, value);
    return value;
  };
  const input=`${runtimeSupportCss}\n${baselineCss}\n${baseCss}\n${candidateCss}\n${candidateSource}`;
  const referenced = new Set([...assetNames(input),...legacyAssetNames(input)]);
  const visitedCss = new Set();
  for (const name of referenced) {
    if (!name.endsWith('.css') || visitedCss.has(name)) continue;
    visitedCss.add(name);
    const file = localAssetPath(name);
    if (!file) continue;
    for (const nested of assetNames(fs.readFileSync(file, 'utf8'))) referenced.add(nested);
  }
  const dependencies = [...referenced].sort().map(name => {
    const file = localAssetPath(name);
    return {name, sha256: fileSha(file), status: file ? 'local-cache' : 'missing'};
  });
  return {
    referenced_asset_names: [...referenced].sort(),
    asset_dependencies: dependencies,
    asset_dependency_sha256: digest(Buffer.from(JSON.stringify(dependencies))),
  };
}

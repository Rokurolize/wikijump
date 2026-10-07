import fs from 'node:fs';
import path from 'node:path';

import {currentPackageBaseCss} from './candidate-base-contract.mjs';
import {resolveExistingContainedFile,resolveExistingPackageDirectory,resolveExistingPackageFile} from './package-path.mjs';

const templateByGeneration={
  sigma9:'scenarios/jp-sigma9-extra-black-canonical.json',
  sigma10:'scenarios/jp-sigma10-extra-black-canonical.json',
};

export function themeScenarioConfigForPackage(root,{generation,packageName}){
  const templatePath=templateByGeneration[generation];
  if(!templatePath)throw new Error(`unsupported canonical scenario generation: ${generation}`);
  if(!/^[a-z0-9-]+$/u.test(packageName??''))throw new Error(`invalid maintained package name: ${packageName}`);
  const ledger=JSON.parse(fs.readFileSync(resolveExistingContainedFile(root,'ports/adaptation-authority.json','Maintained package ledger'),'utf8'));
  const entry=ledger.packages?.[packageName];if(!entry)throw new Error(`unknown maintained package: ${packageName}`);
  const directory=resolveExistingPackageDirectory(path.join(root,'ports'),packageName,`${packageName}: package directory`);
  resolveExistingPackageFile(directory,'candidate.css',`${packageName}: candidate CSS`);
  const sourceFile=entry.source_file??'candidate.wikidot.source.txt';
  resolveExistingPackageFile(directory,sourceFile,`${packageName}: candidate source`);
  const config=JSON.parse(fs.readFileSync(resolveExistingContainedFile(root,templatePath,'Canonical scenario generation template'),'utf8'));
  const base=currentPackageBaseCss(directory,packageName);
  config.theme={
    id:packageName,
    css:`ports/${packageName}/candidate.css`,
    source:`ports/${packageName}/${sourceFile}`,
    ...(base?{base_css:`ports/${packageName}/candidate-base.css`}:{}),
  };
  return config;
}

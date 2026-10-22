import fs from 'node:fs';
import path from 'node:path';

import {currentPackageBaseCss} from './candidate-base-contract.mjs';
import {resolveExistingContainedFile,resolveExistingPackageDirectory,resolveExistingPackageFile} from './package-path.mjs';
import {resolveRunContractOption} from './current-run-contract-option.mjs';

const templateByGeneration={
  sigma9:'scenarios/jp-sigma9-extra-black-canonical.json',
  sigma10:'scenarios/jp-sigma10-extra-black-canonical.json',
};

export function themeScenarioConfigForPackage(root,{generation,packageName,runContract=null}){
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
  if(runContract!==null){
    const contractPath=resolveRunContractOption(root,runContract,{generation});
    const contract=JSON.parse(fs.readFileSync(resolveExistingContainedFile(root,contractPath,'Canonical scenario run contract'),'utf8'));
    const expectedBaseline=generation==='sigma10'?'Sigma-10':'Sigma-9';
    if(contract.baseline_theme?.name!==expectedBaseline)throw new Error(`task run contract baseline does not match ${generation}`);
    if(contract.target_site?.slug!==config.branch_profile.site_slug||contract.target_site?.locale!==config.branch_profile.locale)throw new Error('task run contract target site does not match the scenario branch profile');
    let origin;
    try{origin=new URL(contract.target_site.origin)}catch{throw new Error('task run contract target origin is invalid')}
    if(origin.protocol!=='https:'||origin.hostname!=='scpaiueouiuiuiui.wikijump.localhost'||!origin.port||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash)throw new Error('task run contract origin must be the HTTPS local Wikijump site with an explicit port');
    config.runtime.origin=origin.origin;
  }
  const base=currentPackageBaseCss(directory,packageName);
  config.theme={
    id:packageName,
    css:`ports/${packageName}/candidate.css`,
    source:`ports/${packageName}/${sourceFile}`,
    ...(base?{base_css:`ports/${packageName}/candidate-base.css`}:{}),
  };
  return config;
}

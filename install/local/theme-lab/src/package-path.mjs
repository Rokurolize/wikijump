import fs from 'node:fs';
import path from 'node:path';

export function resolveExistingContainedFile(rootDirectory, file, label = 'artifact', baseDirectory = rootDirectory) {
  if (typeof file !== 'string' || !file) throw new Error(`${label}: missing path`);
  const root = fs.realpathSync(rootDirectory);
  const lexical = path.resolve(baseDirectory, file);
  if (lexical === root || !lexical.startsWith(root + path.sep)) throw new Error(`${label} escapes root: ${file}`);
  const actual = fs.realpathSync(lexical);
  if (!actual.startsWith(root + path.sep)) throw new Error(`${label} escapes root: ${file}`);
  if (!fs.statSync(actual).isFile()) throw new Error(`${label} is not a file: ${file}`);
  return actual;
}

export function resolveExistingContainedFileWithoutSymlinks(rootDirectory, file, label = 'artifact', baseDirectory = rootDirectory) {
  const root=fs.realpathSync(rootDirectory),lexical=path.resolve(baseDirectory,file);
  if(lexical===root||!lexical.startsWith(root+path.sep))throw new Error(`${label} escapes root: ${file}`);
  const relative=path.relative(root,lexical);
  let cursor=root;
  for(const part of relative.split(path.sep)){
    cursor=path.join(cursor,part);
    if(fs.lstatSync(cursor).isSymbolicLink())throw new Error(`${label} must not traverse symlinks: ${file}`);
  }
  return resolveExistingContainedFile(root,lexical,label);
}

export function resolveContainedPathWithoutSymlinks(rootDirectory, file, label = 'path', baseDirectory = rootDirectory) {
  if(typeof file!=='string'||!file)throw new Error(`${label}: missing path`);
  const root=fs.realpathSync(rootDirectory),lexical=path.resolve(baseDirectory,file);
  if(lexical===root||!lexical.startsWith(root+path.sep))throw new Error(`${label} escapes root: ${file}`);
  let cursor=root;
  for(const part of path.relative(root,lexical).split(path.sep)){
    cursor=path.join(cursor,part);
    let stat;try{stat=fs.lstatSync(cursor)}catch(error){if(error.code==='ENOENT')return lexical;throw error}
    if(stat.isSymbolicLink())throw new Error(`${label} must not traverse symlinks: ${file}`);
  }
  return lexical;
}

export function resolveExistingContainedDirectory(rootDirectory, directory, label = 'directory', baseDirectory = rootDirectory) {
  if (typeof directory !== 'string' || !directory) throw new Error(`${label}: missing path`);
  const root = fs.realpathSync(rootDirectory);
  const lexical = path.resolve(baseDirectory, directory);
  if (lexical !== root && !lexical.startsWith(root + path.sep)) throw new Error(`${label} escapes root: ${directory}`);
  const actual = fs.realpathSync(lexical);
  if (actual !== root && !actual.startsWith(root + path.sep)) throw new Error(`${label} escapes root: ${directory}`);
  if (!fs.statSync(actual).isDirectory()) throw new Error(`${label} is not a directory: ${directory}`);
  return actual;
}

export function resolveExistingPackageDirectory(portsDirectory, name, label = 'package directory') {
  if (typeof name !== 'string' || !name || path.basename(name) !== name || path.isAbsolute(name)) throw new Error(`${label} has an invalid package name: ${name}`);
  try{return resolveExistingContainedDirectory(portsDirectory,name,label)}
  catch(error){
    if(error.message.includes('escapes root'))throw new Error(`${label} escapes ports root: ${name}`);
    throw error;
  }
}

export function resolveExistingPackageFile(directory, relative, label = 'package file') {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative)) throw new Error(`${label} must be a relative package path`);
  try{return resolveExistingContainedFile(directory,relative,label)}
  catch(error){
    if(error.message.includes('escapes root'))throw new Error(`${label} escapes package: ${relative}`);
    throw error;
  }
}

export function prepareContainedOutputDirectory(rootDirectory, directory, label = 'output directory', baseDirectory = rootDirectory) {
  const root=fs.realpathSync(rootDirectory);
  const lexical=path.resolve(baseDirectory,directory);
  if(lexical===root||!lexical.startsWith(root+path.sep))throw new Error(`${label} escapes root: ${directory}`);
  let ancestor=lexical;
  while(!fs.existsSync(ancestor)){
    const parent=path.dirname(ancestor);
    if(parent===ancestor)throw new Error(`${label} has no existing parent: ${directory}`);
    ancestor=parent;
  }
  const actualAncestor=fs.realpathSync(ancestor);
  if(actualAncestor!==root&&!actualAncestor.startsWith(root+path.sep))throw new Error(`${label} escapes root: ${directory}`);
  fs.mkdirSync(lexical,{recursive:true});
  const actual=fs.realpathSync(lexical);
  if(actual===root||!actual.startsWith(root+path.sep))throw new Error(`${label} escapes root: ${directory}`);
  if(!fs.statSync(actual).isDirectory())throw new Error(`${label} is not a directory: ${directory}`);
  return actual;
}

export function prepareContainedOutputFile(rootDirectory, file, label = 'output file', baseDirectory = rootDirectory) {
  if(typeof file!=='string'||!file)throw new Error(`${label}: missing path`);
  const lexical=path.resolve(baseDirectory,file);
  const root=fs.realpathSync(rootDirectory),parent=path.dirname(lexical);
  const directory=path.resolve(parent)===root
    ?root
    :prepareContainedOutputDirectory(rootDirectory,parent,`${label} parent`);
  const target=path.join(directory,path.basename(lexical));
  if(fs.existsSync(target)){
    const stat=fs.lstatSync(target);
    if(stat.isSymbolicLink())throw new Error(`${label} must not be a symlink: ${file}`);
    if(!stat.isFile())throw new Error(`${label} is not a file: ${file}`);
    const actual=fs.realpathSync(target);
    if(!actual.startsWith(root+path.sep))throw new Error(`${label} escapes root: ${file}`);
  }
  return target;
}

export function prepareCanonicalChildOutputDirectory(rootDirectory, name, requestedDirectory, label = 'output directory') {
  if(typeof name!=='string'||!name||path.basename(name)!==name||path.isAbsolute(name))throw new Error(`${label} has an invalid child name: ${name}`);
  const root=fs.realpathSync(rootDirectory),expected=path.join(root,name),requested=path.resolve(requestedDirectory);
  if(requested!==expected)throw new Error(`${label} must be the canonical child ${expected}`);
  const actual=prepareContainedOutputDirectory(root,name,label);
  if(actual!==expected)throw new Error(`${label} must not be a symlink: ${requestedDirectory}`);
  return actual;
}

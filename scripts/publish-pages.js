import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {validateManifest} from './manifest.js';

const root=process.cwd(),dist=path.join(root,'dist');
const manifest=validateManifest(JSON.parse(fs.readFileSync(path.join(dist,'sketch.json'))));
for(const name of ['index.html',manifest.thumbnail.src,'catalogue.json','site-entry.json','.nojekyll'])
  if(!fs.existsSync(path.join(dist,name)))throw new Error(`Incomplete build: ${name}`);
const origin=execFileSync('git',['remote','get-url','origin'],{encoding:'utf8'}).trim();
if(origin.replace(/\.git$/,'')!==manifest.repository)throw new Error('Origin differs from sketch metadata.');
const git=(args,cwd=root)=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'sketch-pages-'));
try {
  const exists=git(['ls-remote','--heads',origin,'gh-pages']);
  if(exists)git(['clone','--depth','1','--branch','gh-pages',origin,directory]);
  else {git(['init','-b','gh-pages',directory]);git(['remote','add','origin',origin],directory);}
  for(const name of fs.readdirSync(directory))if(name!=='.git')fs.rmSync(path.join(directory,name),{recursive:true,force:true});
  fs.cpSync(dist,directory,{recursive:true});
  git(['config','user.name',git(['config','user.name'])],directory);
  git(['config','user.email',git(['config','user.email'])],directory);
  git(['add','-A'],directory);
  if(git(['status','--porcelain'],directory)) {
    git(['commit','-m',`Publish ${manifest.title}`],directory);
    git(['push','origin','gh-pages'],directory);
  }
  console.log(`Published build: ${git(['rev-parse','HEAD'],directory)}`);
} finally {fs.rmSync(directory,{recursive:true,force:true});}

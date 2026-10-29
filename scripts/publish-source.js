import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {validateManifest} from './manifest.js';

const root=process.cwd();
const manifest=validateManifest(JSON.parse(fs.readFileSync(path.join(root,'public/sketch.json'))));
const git=(args,cwd=root)=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const origin=git(['remote','get-url','origin']);
if(origin.replace(/\.git$/,'')!==manifest.repository)throw new Error('Origin differs from sketch metadata.');
// The working repo retains reference material in its older private commits.
// Publish committed source files as a clean snapshot, without those objects.
const excluded=file=>/^(?:ignoreMe|reports|node_modules|dist)\//.test(file)
  || /(?:^|\/)__pycache__\//.test(file) || /\.pyc$/.test(file)
  || (!file.includes('/')&&/\.(?:mp4|webm|mov|wav|mp3)$/i.test(file))
  || /^\.env(?:\.|$)/.test(file)&&file!=='.env.example';
const files=git(['ls-files','-z']).split('\0').filter(file=>file&&!excluded(file));
try{git(['diff','--exit-code','HEAD','--',...files]);}
catch{throw new Error('Commit source changes locally before publishing.');}
if(process.argv.includes('--dry-run')){
  console.log(`Ready to publish ${files.length} committed source files to ${manifest.repository} (main). Reference media, recordings and local Git history are excluded.`);
  process.exit(0);
}
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'sketch-source-'));
try{
  const exists=git(['ls-remote','--heads',origin,'main']);
  if(exists)git(['clone','--depth','1','--branch','main',origin,directory]);
  else{git(['init','-b','main',directory]);git(['remote','add','origin',origin],directory);}
  for(const name of fs.readdirSync(directory))if(name!=='.git')fs.rmSync(path.join(directory,name),{recursive:true,force:true});
  for(const file of files){const target=path.join(directory,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(root,file),target);}
  git(['config','user.name',git(['config','user.name'])],directory);
  git(['config','user.email',git(['config','user.email'])],directory);
  git(['add','-A'],directory);
  if(git(['status','--porcelain'],directory)){
    git(['commit','-m',`Publish ${manifest.title} source (${git(['rev-parse','--short','HEAD'])})`],directory);
    git(['push','origin','main'],directory);
  }
  console.log(`Published source: ${git(['rev-parse','HEAD'],directory)}`);
}finally{fs.rmSync(directory,{recursive:true,force:true});}

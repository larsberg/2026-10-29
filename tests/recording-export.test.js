import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {createRecordingHandler} from '../server/recording-api.js';

test('local recording export saves MP4 bytes and rejects cross-origin, path and size violations',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'curtain-recording-')),handler=createRecordingHandler(directory,{maxBytes:64});
  const bytes=Buffer.from([0,0,0,24,...Buffer.from('ftypisom'),0,0,0,0]);
  async function request({body=bytes,origin='http://127.0.0.1:1234',filename='clip.mp4'}={}){
    const req=Readable.from([body]);req.url='/api/recording';req.method='PUT';req.headers={host:'127.0.0.1:1234',origin,'content-type':'video/mp4','x-recording-filename':filename};
    const res={setHeader(){},end(body){this.body=JSON.parse(body);}};await handler(req,res,()=>assert.fail('Unexpected fallback'));return res;
  }
  try{
    const saved=await request();assert.equal(saved.statusCode,200);assert.deepEqual(await readFile(join(directory,'clip.mp4')),bytes);
    assert.equal((await request({origin:'https://elsewhere.example'})).statusCode,403);
    assert.equal((await request({filename:'../escape.mp4'})).statusCode,400);
    assert.equal((await request({body:Buffer.from('not a video')})).statusCode,400);
    assert.equal((await request({body:Buffer.alloc(65)})).statusCode,413);
    assert.deepEqual(await readdir(directory),['clip.mp4']);
  }finally{await rm(directory,{recursive:true,force:true});}
});

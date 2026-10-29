import {randomUUID} from 'node:crypto';
import {mkdir,open,rename,rm} from 'node:fs/promises';
import {join} from 'node:path';

// Local development export; never included as a production server endpoint.
export function createRecordingHandler(directory,{maxBytes=256*1024*1024}={}){
  return async(request,response,next)=>{
    if(request.url?.split('?')[0]!=='/api/recording')return next();
    const send=(status,body)=>{response.statusCode=status;response.setHeader('Content-Type','application/json');response.end(JSON.stringify(body));};
    if(request.method!=='PUT')return send(405,{error:'Use PUT to save a recording.'});
    let sameOrigin=false;try{sameOrigin=new URL(request.headers.origin).host===request.headers.host;}catch{}
    if(!sameOrigin)return send(403,{error:'Save from the sketch’s own local page.'});
    const type=request.headers['content-type']?.split(';')[0],filename=request.headers['x-recording-filename'];
    if(type!=='video/mp4'||typeof filename!=='string'||! /^[a-z0-9][a-z0-9._-]{0,120}\.mp4$/.test(filename))return send(400,{error:'Send an MP4 with a plain filename.'});
    const temporary=join(directory,`.recording-${randomUUID()}.tmp`);let file,bytes=0,header=Buffer.alloc(0);
    try{
      await mkdir(directory,{recursive:true});file=await open(temporary,'wx');
      for await(const chunk of request.iterator({destroyOnReturn:false})){
        bytes+=chunk.length;if(bytes>maxBytes){request.resume();return send(413,{error:'Recording exceeds 256 MB.'});}
        if(header.length<12)header=Buffer.concat([header,chunk.subarray(0,12-header.length)]);
        await file.writeFile(chunk);
      }
      await file.close();file=undefined;
      if(header.length<12||header.toString('ascii',4,8)!=='ftyp')return send(400,{error:'The file is not an MP4 recording.'});
      await rename(temporary,join(directory,filename));send(200,{path:`reports/${filename}`,bytes});
    }catch{send(500,{error:'Could not save the recording to disk.'});}
    finally{await file?.close().catch(()=>{});await rm(temporary,{force:true});}
  };
}

export function recordingApiPlugin(){return {name:'local-recording-export',apply:'serve',configureServer(server){server.middlewares.use(createRecordingHandler(join(server.config.root,'reports')));}};}

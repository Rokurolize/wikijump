import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import zlib from 'node:zlib';

const PNG_SIGNATURE=Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);

function paeth(a,b,c){
 const p=a+b-c;
 const pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);
 return pa<=pb&&pa<=pc?a:pb<=pc?b:c;
}

export function pngPixelSha256(bytes){
 if(!Buffer.isBuffer(bytes))bytes=Buffer.from(bytes);
 if(bytes.length<33||!bytes.subarray(0,8).equals(PNG_SIGNATURE))throw new Error('not a PNG');
 let offset=8,width=null,height=null,bitDepth=null,colorType=null,interlace=null;
 const idat=[];
 while(offset+12<=bytes.length){
  const length=bytes.readUInt32BE(offset);const type=bytes.subarray(offset+4,offset+8).toString('ascii');
  const start=offset+8,end=start+length;
  if(end+4>bytes.length)throw new Error('truncated PNG chunk');
  const data=bytes.subarray(start,end);
  if(type==='IHDR'){
   width=data.readUInt32BE(0);height=data.readUInt32BE(4);bitDepth=data[8];colorType=data[9];interlace=data[12];
  }else if(type==='IDAT')idat.push(data);
  else if(type==='IEND')break;
  offset=end+4;
 }
 if(!width||!height||!idat.length)throw new Error('PNG is missing IHDR/IDAT');
 if(bitDepth!==8||interlace!==0)throw new Error(`unsupported PNG format: bitDepth=${bitDepth} interlace=${interlace}`);
 const channels={0:1,2:3,4:2,6:4}[colorType];
 if(!channels)throw new Error(`unsupported PNG color type: ${colorType}`);
 const stride=width*channels;
 const raw=zlib.inflateSync(Buffer.concat(idat));
 const expected=(stride+1)*height;
 if(raw.length!==expected)throw new Error(`unexpected PNG scanline length: expected ${expected}, got ${raw.length}`);
 const hash=crypto.createHash('sha256');
 hash.update('theme-lab-png-pixels-v1\0');
 const header=Buffer.allocUnsafe(9);header.writeUInt32BE(width,0);header.writeUInt32BE(height,4);header[8]=channels;hash.update(header);
 let previous=Buffer.alloc(stride);let cursor=0;
 for(let y=0;y<height;y++){
  const filter=raw[cursor++];const encoded=raw.subarray(cursor,cursor+stride);cursor+=stride;
  const row=Buffer.allocUnsafe(stride);
  for(let x=0;x<stride;x++){
   const value=encoded[x],left=x>=channels?row[x-channels]:0,up=previous[x]??0,upLeft=x>=channels?(previous[x-channels]??0):0;
   if(filter===0)row[x]=value;
   else if(filter===1)row[x]=(value+left)&0xff;
   else if(filter===2)row[x]=(value+up)&0xff;
   else if(filter===3)row[x]=(value+Math.floor((left+up)/2))&0xff;
   else if(filter===4)row[x]=(value+paeth(left,up,upLeft))&0xff;
   else throw new Error(`unsupported PNG filter: ${filter}`);
  }
  hash.update(row);previous=row;
 }
 return hash.digest('hex');
}

export async function pngPixelSha256File(file){
 return pngPixelSha256(await fs.readFile(file));
}

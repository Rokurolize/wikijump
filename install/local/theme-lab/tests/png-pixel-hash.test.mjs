import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import test from 'node:test';
import {pngPixelSha256} from '../ports/scripts/png-pixel-hash.mjs';

const signature=Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);
const crcTable=Array.from({length:256},(_,n)=>{
 let c=n;
 for(let i=0;i<8;i++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;
 return c>>>0;
});
function crc32(bytes){
 let c=0xffffffff;
 for(const byte of bytes)c=crcTable[(c^byte)&0xff]^(c>>>8);
 return (c^0xffffffff)>>>0;
}
function chunk(type,data){
 const name=Buffer.from(type);const out=Buffer.alloc(12+data.length);
 out.writeUInt32BE(data.length,0);name.copy(out,4);data.copy(out,8);
 out.writeUInt32BE(crc32(Buffer.concat([name,data])),8+data.length);
 return out;
}
function rgbPng({level=6,text=null,pixels=Buffer.from([255,0,0,0,255,0,0,0,255,255,255,255])}={}){
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(2,0);ihdr.writeUInt32BE(2,4);ihdr[8]=8;ihdr[9]=2;
 const raw=Buffer.concat([Buffer.from([0]),pixels.subarray(0,6),Buffer.from([0]),pixels.subarray(6,12)]);
 const parts=[signature,chunk('IHDR',ihdr)];
 if(text)parts.push(chunk('tEXt',Buffer.from(text)));
 parts.push(chunk('IDAT',zlib.deflateSync(raw,{level})),chunk('IEND',Buffer.alloc(0)));
 return Buffer.concat(parts);
}

test('pixel hash ignores PNG compression and ancillary metadata',()=>{
 const a=rgbPng({level:0});
 const b=rgbPng({level:9,text:'note\0same pixels'});
 assert.notEqual(crypto.createHash('sha256').update(a).digest('hex'),crypto.createHash('sha256').update(b).digest('hex'));
 assert.equal(pngPixelSha256(a),pngPixelSha256(b));
});

test('pixel hash changes when a rendered pixel changes',()=>{
 const a=rgbPng();
 const pixels=Buffer.from([255,0,0,0,255,0,0,0,255,254,255,255]);
 const b=rgbPng({pixels});
 assert.notEqual(pngPixelSha256(a),pngPixelSha256(b));
});

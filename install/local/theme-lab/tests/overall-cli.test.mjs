import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {overallAcceptance} from '../src/verdict.mjs';

for(const [port,target,status,code] of [['pass','fail','fail',1],['inconclusive','pass','inconclusive',2],['pass','pass','pass',0]]) {
  test(`CLI final result: port ${port}, target ${target} -> ${status}`,async()=>{
    const dir=await fs.mkdtemp(path.join(os.tmpdir(),'theme-overall-cli-'));
    const socket=path.join(dir,'session.sock');
    const result={verdict:overallAcceptance(port,target),overall_acceptance:{status},port_decision:{verdict:port},target_acceptance:{status:target}};
    const server=net.createServer(client=>client.once('data',()=>client.end(JSON.stringify({ok:true,result})+'\n')));
    try {
      await new Promise(resolve=>server.listen(socket,resolve));
      const cli=fileURLToPath(new URL('../scripts/theme-lab.mjs',import.meta.url));
      const child=spawn(process.execPath,[cli,'check','--socket',socket,'--compact']);
      let stdout='',stderr='';child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);
      const exit=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve)});
      assert.equal(exit,code,stderr);
      const response=JSON.parse(stdout);
      assert.equal(response.verdict,status);
      assert.equal(response.overall_acceptance.status,status);
      assert.equal(response.result.port_decision.verdict,port);
      assert.equal(response.result.target_acceptance.status,target);
    } finally {await new Promise(resolve=>server.close(resolve));await fs.rm(dir,{recursive:true,force:true});}
  });
}

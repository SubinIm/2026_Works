// Test adapter: actual disk bytes, with browser-like committed writable streams.
import {mkdir,readdir,readFile,writeFile,stat,rename,unlink,open} from 'node:fs/promises';
import path from 'node:path';
const missing=()=>new DOMException('Missing entry','NotFoundError');
function child(base,name){if(typeof name!=='string' || !name || /[\\/:]/.test(name) || name==='.' || name==='..')throw Error('Invalid test path');const full=path.resolve(base,name);if(!full.startsWith(path.resolve(base)+path.sep))throw Error('Escaped test directory');return full;}
export class NodeDirectory{
 constructor(dir,hooks={}){this.dir=dir;this.name=path.basename(dir);this.kind='directory';this.hooks=hooks;}
 async getDirectoryHandle(name,{create=false}={}){const dir=child(this.dir,name);if(create)await mkdir(dir,{recursive:true});try{if(!(await stat(dir)).isDirectory())throw missing();}catch(e){if(e.code==='ENOENT')throw missing();throw e;}return new NodeDirectory(dir,this.hooks);}
 async getFileHandle(name,{create=false}={}){const file=child(this.dir,name);if(create){const fd=await open(file,'a');await fd.close();}try{if(!(await stat(file)).isFile())throw missing();}catch(e){if(e.code==='ENOENT')throw missing();throw e;}return new NodeFile(file,this.hooks);}
 async *entries(){for(const entry of await readdir(this.dir,{withFileTypes:true})){if(entry.name.endsWith('.pending'))continue;yield [entry.name,entry.isDirectory()?new NodeDirectory(child(this.dir,entry.name),this.hooks):new NodeFile(child(this.dir,entry.name),this.hooks)];}}
 async requestPermission(){return 'granted';}async queryPermission(){return 'granted';}
}
class NodeFile{
 constructor(file,hooks){this.file=file;this.name=path.basename(file);this.kind='file';this.hooks=hooks;}
 async getFile(){const bytes=await readFile(this.file);return new File([bytes],this.name);}
 async createWritable(){const temp=this.file+'.'+crypto.randomUUID()+'.pending';return {write:async data=>{if(this.hooks.fail?.(this.file))throw Error('Simulated write failure');await writeFile(temp,data);},close:async()=>rename(temp,this.file),abort:async()=>{try{await unlink(temp);}catch(e){if(e.code!=='ENOENT')throw e;}}};}
}

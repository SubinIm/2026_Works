// UI fixture only: no OS folder picker and no access to user files.
export class MemoryDirectory{
 constructor(name='예시 공유 폴더',permission={value:'granted'}){this.name=name;this.kind='directory';this.items=new Map();this.permission=permission;}
 async getDirectoryHandle(name,{create=false}={}){if(!this.items.has(name) && create)this.items.set(name,new MemoryDirectory(name,this.permission));const item=this.items.get(name);if(!item || item.kind!=='directory')throw new DOMException('Missing','NotFoundError');return item;}
 async getFileHandle(name,{create=false}={}){if(!this.items.has(name) && create)this.items.set(name,new MemoryFile(name));const item=this.items.get(name);if(!item || item.kind!=='file')throw new DOMException('Missing','NotFoundError');return item;}
 async *entries(){yield* this.items.entries();}
 async requestPermission(){return this.permission.value;}async queryPermission(){return this.permission.value;}
}
class MemoryFile{
 constructor(name){this.name=name;this.kind='file';this.data='';}
 async getFile(){return new File([this.data],this.name);}
 async createWritable(){let pending;return {write:async data=>{pending=data;},close:async()=>{this.data=pending;},abort:async()=>{}};}
}

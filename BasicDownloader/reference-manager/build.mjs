import {mkdir,copyFile} from 'node:fs/promises';
const dir=new URL('./dist/',import.meta.url);await mkdir(dir,{recursive:true});
for(const file of ['manifest.json','model.js','db.js','capture.js','popup.html','popup.js','library.html','library.js','style.css'])await copyFile(new URL(file,import.meta.url),new URL(file,dir));
console.log('Ready: reference-manager/dist — load this folder as an unpacked extension.');

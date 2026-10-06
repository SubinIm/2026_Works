import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalize,duplicate,safeUrl,bibtex,parseBackup} from '../model.js';
test('DOI and URL duplicate checks preserve meaningful URL parameters',()=>{
 const r=normalize({title:'A',doi:'https://doi.org/10.1000/ABC',url:'https://example.com/p?a=1&utm_source=web#section'});
 assert.equal(duplicate([r],{doi:'doi:10.1000/abc'}),r);
 assert.equal(duplicate([r],{url:'https://example.com/p?a=1'}),r);
 assert.equal(duplicate([r],{url:'https://example.com/p?a=2'}),undefined);
 assert.equal(duplicate([r],r),undefined);
});
test('untrusted links and blank titles are rejected',()=>{
 assert.equal(safeUrl('javascript:alert(1)'),'');assert.equal(safeUrl('file:///C:/secret'),'');
 assert.throws(()=>normalize({title:'  '}));assert.equal(normalize({title:'X',url:'data:text/html,bad'}).url,'');
});
test('BibTeX escapes input and joins semicolon-separated authors',()=>{
 const text=bibtex([normalize({title:'Test {a} & b',authors:'A; B',date:'2025-03'})]);
 assert.match(text,/Test \\\{a\\\} \\& b/);assert.match(text,/A and B/);assert.match(text,/year = \{2025\}/);
});
test('backup validation roundtrips records and rejects unsupported formats',()=>{
 const r=normalize({title:'A'});r.attachment={name:'paper.pdf',data:'data:application/pdf;base64,JVBERi0='};
 const parsed=parseBackup(JSON.stringify({format:'paperdesk',version:1,records:[r]}));assert.equal(parsed[0].id,r.id);assert.deepEqual(parsed[0].attachment,r.attachment);
 assert.throws(()=>parseBackup('{"records":[]}'));r.attachment.data='javascript:bad';assert.throws(()=>parseBackup(JSON.stringify({format:'paperdesk',version:1,records:[r]})));
});

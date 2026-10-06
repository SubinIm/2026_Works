import test from 'node:test';
import assert from 'node:assert/strict';
import { NetworkObserver } from '../src/background/network-observer.ts';
const settle=()=>new Promise(resolve=>setImmediate(resolve));
test('network capture detects media before completion and does not duplicate it on completion',async()=>{
  const events:Record<string,(d:any)=>void>={};const captured:any[]=[];
  (globalThis as any).chrome={webRequest:Object.fromEntries(['onBeforeRequest','onBeforeSendHeaders','onHeadersReceived','onCompleted','onErrorOccurred'].map(name=>[name,{addListener:(fn:any)=>events[name]=fn}])),tabs:{get:async()=>({url:'https://site.test/watch',title:'Video'})}};
  const observer=new NetworkObserver({upsert:async(c:any)=>captured.push(c),addSegmentEvidence:async()=>{}} as any);
  observer.start();
  const details={requestId:'1',url:'https://cdn.test/live',tabId:1,frameId:0,method:'GET',type:'xmlhttprequest',timeStamp:10};
  events.onBeforeRequest(details);
  events.onHeadersReceived({...details,statusCode:200,responseHeaders:[{name:'Content-Type',value:'application/vnd.apple.mpegurl'}]});
  await settle();assert.equal(captured.length,1);assert.equal(captured[0].mediaKind,'hls');
  events.onCompleted(details);await settle();assert.equal(captured.length,1);
  for(const [requestId,method,statusCode,mime] of [['2','POST',200,'application/vnd.yt-ump'],['3','GET',403,'video/mp4'],['4','GET',200,'application/vnd.yt-ump']]){
    const d={...details,requestId,method};events.onBeforeRequest(d);events.onHeadersReceived({...d,statusCode,responseHeaders:[{name:'Content-Type',value:mime}]});events.onCompleted(d);
  }
  await settle();assert.equal(captured.length,1,'SABR POST, auth failure and UMP response must not become download candidates');
  delete (globalThis as any).chrome;
});
